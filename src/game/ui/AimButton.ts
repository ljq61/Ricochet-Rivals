import { t } from '../i18n/locale';
import Phaser from 'phaser';
import { CameraMode } from '../camera/CameraMode';
import { ART } from '../config/ArtAssets';
import { SfxBus, SFX } from '../audio/SfxBus';
import { touchAimRect } from './touchControlLayout';
import type { ViewportService } from '../platform/ViewportService';
import type { InputRouter } from '../input/InputRouter';
import type { PlayerId } from '../state/ids';

const DESKTOP_SIZE = { width: 360, height: 84 };
const DESKTOP_BOTTOM_MARGIN = 76;

export interface AimButtonDeps {
  router: InputRouter;
  viewport: ViewportService;
  isTouchProfile: boolean;
  getPlayerId: () => PlayerId;
  /** 点击行为由 BattleScene 决定（AIMING 时取消，否则发起瞄准） */
  onTap: () => void;
}

/**
 * 固定 HUD 按钮：「回到炮手 / 瞄准 / 取消瞄准」（CODELY.md §9）。
 *
 * - 命中走 InputRouter zone（UI 最高优先级），不再用 Phaser
 *   setInteractive —— 一次手势生命周期只有一个 Owner
 * - AIMING 时点击 = 取消瞄准（触屏没有 Esc / 右键，按钮即取消入口）
 * - 圆形两态图片：READY 彩色银框 / AIMING 彩色金框，
 *   简化持枪角色与右上向左下的手指箭头；红方水平镜像，待机外侧光晕提示点击，
 *   素材缺失回退程序绘制）
 * - 跟随 ViewportService 变化重定位（resize / 旋转 / DPR 变化）
 *
 * 真机修复（高分屏清晰渲染）：游戏坐标 = 物理像素，
 * 所有屏幕手感常量经 uiScale（= DPR）换算 —— CSS 观感跨设备恒定。
 */
export class AimButton {
  private readonly deps: AimButtonDeps;
  private readonly container: Phaser.GameObjects.Container;
  private readonly halo: Phaser.GameObjects.Graphics;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  /** 真机反馈轮：触屏两态生成图标（缺失 = null → Graphics 回退） */
  private readonly icon: Phaser.GameObjects.Image | null;
  /** 可瞄准时的外侧光晕；激活、隐藏或 destroy 时停。 */
  private pulseTween: Phaser.Tweens.Tween | null = null;
  /** 游戏像素尺寸（物理像素口径，随 uiScale 变化重算） */
  private width: number;
  private height: number;
  private hovered = false;
  private screenX = 0;
  private screenY = 0;
  private layoutPlayerId: PlayerId | null = null;
  /** Phase 14：本地回合外（对手回合）隐藏并失活 zone */
  private interactable = true;
  /** 机械点击反馈（按下时随 zone 触发；音量/开关门禁在 SfxBus 内） */
  private readonly sfx: SfxBus;
  private readonly unsubscribeViewport: () => void;

  /** 游戏像素命中矩形，供浏览器验证使用真实按钮位置。 */
  get screenBounds(): { x: number; y: number; width: number; height: number } {
    return { x: this.screenX, y: this.screenY, width: this.width, height: this.height };
  }

  get visualState(): { visible: boolean; flipped: boolean; active: boolean; hintVisible: boolean; hintAlpha: number } {
    return { visible: this.container.visible, flipped: this.icon?.flipX ?? false, active: this.icon?.texture.key === ART.aimActive,
      hintVisible: this.halo.visible, hintAlpha: this.halo.alpha };
  }

  constructor(
    private readonly scene: Phaser.Scene,
    deps: AimButtonDeps
  ) {
    this.deps = deps;

    this.halo = scene.add.graphics().setVisible(false);
    this.bg = scene.add.graphics();

    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0.5);

    // 两态生成图标（桌面与触屏共用；BootScene 预加载，缺失回退 Graphics）
    this.icon =
      scene.textures.exists(ART.aimReady)
        ? scene.add.image(0, 0, ART.aimReady, 'button')
        : null;

    this.container = scene.add
      .container(0, 0, [this.halo, this.bg, this.label])
      .setScrollFactor(0)
      .setDepth(900);
    if (this.icon) {
      this.container.add(this.icon);
    }

    this.width = DESKTOP_SIZE.width;
    this.height = DESKTOP_SIZE.height;
    this.sfx = new SfxBus(scene);

    this.deps.router.registerZone({
      id: 'aim-button',
      kind: 'UI',
      isActive: () => this.interactable,
      contains: (x, y) => this.contains(x, y),
      onDown: () => {
        this.sfx.play(SFX.click);
        deps.onTap();
      },
      onHover: (inside) => {
        this.hovered = inside;
      },
    });

    this.unsubscribeViewport = deps.viewport.onChange(() => {
      this.reposition();
    });
    this.reposition();
  }

  /**
   * 根据相机模式刷新按钮外观与文案（两态，Phase 17 真机反馈轮）。
   * READY = 彩色银框 + 外侧光晕（点击发起瞄准）；AIMING = 彩色金框（点击取消）。
   * interactable（Phase 14 联机）：本地玩家回合 = true；对手回合 = false
   * → 按钮隐藏且 zone 失活（对手回合 Move/Aim/Fire 全部禁用，
   * 相机 Free View 仍可用）。离线不传 = 恒可交互，行为不变。
   */
  refresh(mode: CameraMode, interactable = true): void {
    if (this.layoutPlayerId !== this.deps.getPlayerId()) this.reposition();
    this.icon?.setFlipX(this.deps.getPlayerId() === 'P2');
    this.interactable = interactable;
    this.container.setVisible(interactable);
    if (!interactable) {
      this.stopPulse();
      return; // 隐藏后无需重绘
    }
    const aiming = mode === CameraMode.AIMING;
    const inFlow =
      mode === CameraMode.FREE_VIEW || mode === CameraMode.RETURN_HOME;
    this.updateHint(!aiming && inFlow);

    if (this.deps.isTouchProfile) {
      this.drawTouchIcon(aiming, inFlow);
      return;
    }
    this.drawDesktopButton(aiming, inFlow);
  }

  /** 桌面态：金属药丸（MenuButton 同语言），银色待机 / 金色激活。 */
  private drawDesktopButton(aiming: boolean, inFlow: boolean): void {
    const ui = this.deps.viewport.current.uiScale;
    const { width, height } = this;
    const accent = aiming ? 0xf3a725 : 0x899298;
    const active = aiming || (this.hovered && inFlow);

    this.label.setText(
      aiming ? t('取消瞄准 · Esc / 右键', 'Cancel · Esc / Right click') : t('回到炮手 / 瞄准 [Space]', 'Return / Aim [Space]')
    );
    this.label.setColor('#151c22');
    this.label.setX(this.icon ? 34 * ui : 0);
    this.updateIcon(aiming);
    this.icon?.setPosition(-width / 2 + 44 * ui, 0).setDisplaySize(60 * ui, 60 * ui);
    this.label.setFontStyle('bold');

    const radius = 4 * ui;
    this.bg.clear();
    this.bg.fillStyle(0x080d12, 1);
    this.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.bg.fillStyle(accent, active ? 1 : 0.88);
    this.bg.fillRoundedRect(
      -width / 2 + 4 * ui,
      -height / 2 + 4 * ui,
      width - 8 * ui,
      height - 8 * ui,
      radius
    );
    // 顶高光线 + 四角铆钉（与菜单金属按钮同款）
    this.bg.lineStyle(2 * ui, aiming ? 0xffe19a : 0xd5dce3, 0.55);
    this.bg.lineBetween(
      -width / 2 + 10 * ui,
      -height / 2 + 7 * ui,
      width / 2 - 10 * ui,
      -height / 2 + 7 * ui
    );
    this.bg.fillStyle(0x151c22, 1);
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        this.bg.fillCircle(
          x * (width / 2 - 10 * ui),
          y * (height / 2 - 10 * ui),
          2.5 * ui
        );
      }
    }
    this.bg.lineStyle(2 * ui, aiming ? 0xffe19a : 0xd5dce3, 1);
    this.bg.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);

    this.container.setAlpha(inFlow || aiming ? 1 : 0.5);
  }

  /**
   * 触屏态：生成图标两态（真机反馈轮）——
   * READY = 彩色银框操作示意图 + 外侧光晕（点击发起瞄准）；
   * AIMING = 彩色金框操作示意图，光晕消失（点击取消）。
   * 图标缺失时回退程序绘制（金属盘 + 准星，无斜杠禁止语义）。
   */
  private drawTouchIcon(aiming: boolean, inFlow: boolean): void {
    const alpha = inFlow || aiming ? 1 : 0.55;

    if (this.icon !== null) {
      this.label.setText(aiming ? t('取消', 'Cancel') : t('瞄准', 'Aim')).setFontSize(12 * this.deps.viewport.current.uiScale)
        .setPosition(0, this.height / 2 + 10 * this.deps.viewport.current.uiScale)
        .setStroke('#151c22', 3 * this.deps.viewport.current.uiScale);
      this.bg.clear();
      this.updateIcon(aiming);
      this.container.setAlpha(alpha);
      return;
    }
    this.drawTouchFallback(aiming, inFlow, alpha);
  }

  private updateIcon(aiming: boolean): void {
    if (!this.icon) return;
    const key = aiming && this.scene.textures.exists(ART.aimActive) ? ART.aimActive : ART.aimReady;
    this.icon.setTexture(key, 'button');
  }

  /** 提示只绘在按钮外侧，不改变图案或边框的透明度。 */
  private updateHint(show: boolean): void {
    if (!show) {
      this.stopPulse();
      return;
    }
    const ui = this.deps.viewport.current.uiScale;
    this.halo.clear();
    for (const [thickness, alpha] of [[16, 0.12], [10, 0.2], [4, 0.5]] as const) {
      this.halo.lineStyle(thickness * ui, 0xd4edff, alpha);
      if (this.deps.isTouchProfile) {
        this.halo.strokeCircle(0, 0, this.width / 2 + 3 * ui);
      } else {
        this.halo.strokeRoundedRect(-this.width / 2 - 3 * ui, -this.height / 2 - 3 * ui,
          this.width + 6 * ui, this.height + 6 * ui, 7 * ui);
      }
    }
    this.halo.setVisible(true);
    this.startPulse();
  }

  /** 待机外侧光晕 alpha 0.25 ↔ 1，图标始终不闪烁。 */
  private startPulse(): void {
    if (this.pulseTween !== null) {
      return;
    }
    this.pulseTween = this.scene.tweens.add({
      targets: this.halo,
      alpha: { from: 0.25, to: 1 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private stopPulse(): void {
    this.pulseTween?.stop();
    this.pulseTween = null;
    this.halo.setVisible(false).setAlpha(1);
  }

  /** Graphics 回退：金属盘 + 准星刻线（灰=可瞄准 / 金=瞄准中） */
  private drawTouchFallback(aiming: boolean, _inFlow: boolean, alpha: number): void {
    const ui = this.deps.viewport.current.uiScale;
    const accent = aiming ? 0xf3a725 : 0x899298;

    this.label.setText('');
    this.bg.clear();

    const r = this.width * 0.46;
    this.bg.fillStyle(0x080d12, alpha);
    this.bg.fillCircle(0, 0, r);
    this.bg.fillStyle(accent, alpha);
    this.bg.fillCircle(0, 0, r - 4 * ui);
    this.bg.lineStyle(2 * ui, aiming ? 0xffe19a : 0xb4b6ad, alpha);
    this.bg.strokeCircle(0, 0, r);
    this.bg.lineStyle(3 * ui, 0x151c22, 0.9);
    this.bg.strokeCircle(0, 0, r * 0.5);
    const tickInner = r * 0.62;
    const tickOuter = r * 0.85;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      this.bg.lineBetween(
        dx * tickInner,
        dy * tickInner,
        dx * tickOuter,
        dy * tickOuter
      );
    }
    this.bg.fillStyle(0x151c22, 0.9);
    this.bg.fillCircle(0, 0, 3.5 * ui);

    this.container.setAlpha(alpha);
  }

  destroy(): void {
    this.stopPulse();
    this.unsubscribeViewport();
    this.deps.router.unregisterZone('aim-button');
    this.container.destroy();
  }

  private contains(x: number, y: number): boolean {
    if (this.deps.isTouchProfile) {
      return (x - this.screenX) ** 2 + (y - this.screenY) ** 2 <= (this.width / 2) ** 2;
    }
    return (
      x >= this.screenX - this.width / 2 &&
      x <= this.screenX + this.width / 2 &&
      y >= this.screenY - this.height / 2 &&
      y <= this.screenY + this.height / 2
    );
  }

  private placeOnScreen(x: number, y: number): void {
    this.screenX = x;
    this.screenY = y;
    const { width, height, zoom } = this.deps.viewport.current;
    this.container.setScale(1 / zoom).setPosition(
      width / 2 + (x - width / 2) / zoom,
      height / 2 + (y - height / 2) / zoom,
    );
  }

  /** 尺寸（×uiScale）+ 定位（Safe Area 内），随视口变化重算 */
  private reposition(): void {
    const { uiScale, width, height, safeArea } = this.deps.viewport.current;
    this.layoutPlayerId = this.deps.getPlayerId();

    // 红方在左、蓝方在右；绘制与命中区共用同一屏幕矩形。
    if (this.deps.isTouchProfile) {
      const rect = touchAimRect(this.deps.viewport.current, this.layoutPlayerId);
      this.width = rect.width;
      this.height = rect.height;
      this.icon?.setDisplaySize(this.width, this.height);
      this.placeOnScreen(rect.x, rect.y);
      return;
    }

    this.width = DESKTOP_SIZE.width * uiScale;
    this.height = DESKTOP_SIZE.height * uiScale;

    this.label.setFontSize(15 * uiScale);

    const bottomMargin = DESKTOP_BOTTOM_MARGIN * uiScale + safeArea.bottom;
    const inset = 12 * uiScale + this.width / 2;
    const x = width - safeArea.left - safeArea.right < inset * 2
      ? safeArea.left + (width - safeArea.left - safeArea.right) / 2
      : this.layoutPlayerId === 'P2' ? safeArea.left + inset : width - safeArea.right - inset;
    this.placeOnScreen(x, height - bottomMargin - this.height / 2);
  }
}
