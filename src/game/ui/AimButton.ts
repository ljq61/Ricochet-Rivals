import Phaser from 'phaser';
import { CameraMode } from '../camera/CameraMode';
import type { ViewportService } from '../platform/ViewportService';
import type { InputRouter } from '../input/InputRouter';

const DESKTOP_SIZE = { width: 300, height: 56 };
/** Phase 9 反馈 ②：触屏档位 = 画面右侧垂直居中的圆形准星 icon */
const TOUCH_ICON_SIZE = 64;
const TOUCH_RIGHT_MARGIN = 20;
const DESKTOP_BOTTOM_MARGIN = 76;

export interface AimButtonDeps {
  router: InputRouter;
  viewport: ViewportService;
  isTouchProfile: boolean;
  /** 点击行为由 BattleScene 决定（AIMING 时取消，否则发起瞄准） */
  onTap: () => void;
}

/**
 * 固定 HUD 按钮：「回到炮手 / 瞄准 / 取消瞄准」（CODELY.md §9）。
 *
 * Phase 6.5 变化：
 * - 命中走 InputRouter zone（UI 最高优先级），不再用 Phaser
 *   setInteractive —— 一次手势生命周期只有一个 Owner
 * - AIMING 时点击 = 取消瞄准（触屏没有 Esc / 右键，按钮即取消入口）
 * - Phase 9 反馈 ②：触屏档位 = 画面右侧垂直居中的准星 icon
 *   （蓝 = 瞄准；AIMING 红 + 斜杠 = 点击取消）；布局遵守 Safe Area
 * - 跟随 ViewportService 变化重定位（resize / 旋转 / DPR 变化）
 *
 * 真机修复（高分屏清晰渲染）：游戏坐标 = 物理像素，
 * 所有屏幕手感常量经 uiScale（= DPR）换算 —— CSS 观感跨设备恒定。
 */
export class AimButton {
  private readonly deps: AimButtonDeps;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  /** 游戏像素尺寸（物理像素口径，随 uiScale 变化重算） */
  private width: number;
  private height: number;
  private hovered = false;
  private readonly unsubscribeViewport: () => void;

  constructor(scene: Phaser.Scene, deps: AimButtonDeps) {
    this.deps = deps;

    this.bg = scene.add.graphics();

    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0.5);

    this.container = scene.add
      .container(0, 0, [this.bg, this.label])
      .setScrollFactor(0)
      .setDepth(900);

    this.width = DESKTOP_SIZE.width;
    this.height = DESKTOP_SIZE.height;

    this.deps.router.registerZone({
      id: 'aim-button',
      kind: 'UI',
      isActive: () => true,
      contains: (x, y) => this.contains(x, y),
      onDown: () => deps.onTap(),
      onHover: (inside) => {
        this.hovered = inside;
      },
    });

    this.unsubscribeViewport = deps.viewport.onChange(() => {
      this.reposition();
    });
    this.reposition();
  }

  /** 根据相机模式刷新按钮外观与文案 */
  refresh(mode: CameraMode): void {
    const aiming = mode === CameraMode.AIMING;
    const inFlow =
      mode === CameraMode.FREE_VIEW || mode === CameraMode.RETURN_HOME;

    // Phase 9 反馈 ②：触屏档位 = 右侧准星 icon（AIMING 红准星 + 斜杠 = 点击取消）
    if (this.deps.isTouchProfile) {
      this.drawTouchIcon(aiming, inFlow);
      return;
    }

    this.label.setText(
      aiming
        ? '瞄准中 · Esc / 右键 取消'
        : '回到炮手 / 瞄准  [Space]'
    );

    this.bg.clear();
    const accent = aiming ? 0x8fa3c7 : 0x3f8cff;
    const fillAlpha = aiming ? 0.25 : this.hovered && inFlow ? 0.95 : 0.7;
    this.bg.fillStyle(0x0d1420, 0.85);
    this.bg.fillRoundedRect(
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
      12 * this.deps.viewport.current.uiScale
    );
    this.bg.fillStyle(accent, fillAlpha);
    this.bg.fillRoundedRect(
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
      12 * this.deps.viewport.current.uiScale
    );
    this.bg.lineStyle(2 * this.deps.viewport.current.uiScale, accent, 0.95);
    this.bg.strokeRoundedRect(
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
      12 * this.deps.viewport.current.uiScale
    );

    this.container.setAlpha(inFlow || aiming ? 1 : 0.5);
  }

  /** 触屏准星 icon：蓝准星 = 点击瞄准；AIMING 红准星 + 斜杠 = 点击取消 */
  private drawTouchIcon(aiming: boolean, inFlow: boolean): void {
    const ui = this.deps.viewport.current.uiScale;
    const accent = aiming ? 0xff5063 : 0x3f8cff;
    const alpha = inFlow || aiming ? 0.95 : 0.5;

    this.label.setText('');
    this.bg.clear();

    const r = this.width * 0.3;
    const tickInner = r * 1.25;
    const tickOuter = r * 2.1;
    this.bg.lineStyle(3 * ui, accent, alpha);
    this.bg.strokeCircle(0, 0, r);
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
    this.bg.fillStyle(accent, alpha);
    this.bg.fillCircle(0, 0, 3.5 * ui);

    if (aiming) {
      const s = tickOuter * 0.85;
      this.bg.lineStyle(3 * ui, accent, alpha);
      this.bg.lineBetween(-s, -s, s, s);
    }

    this.container.setAlpha(alpha);
  }

  destroy(): void {
    this.unsubscribeViewport();
    this.deps.router.unregisterZone('aim-button');
    this.container.destroy();
  }

  private contains(x: number, y: number): boolean {
    return (
      x >= this.container.x - this.width / 2 &&
      x <= this.container.x + this.width / 2 &&
      y >= this.container.y - this.height / 2 &&
      y <= this.container.y + this.height / 2
    );
  }

  /** 尺寸（×uiScale）+ 定位（Safe Area 内），随视口变化重算 */
  private reposition(): void {
    const { uiScale, width, height, safeArea } = this.deps.viewport.current;

    // 触屏：右侧垂直居中的准星 icon（Phase 9 反馈 ②）
    if (this.deps.isTouchProfile) {
      this.width = TOUCH_ICON_SIZE * uiScale;
      this.height = TOUCH_ICON_SIZE * uiScale;
      const margin = TOUCH_RIGHT_MARGIN * uiScale + safeArea.right;
      this.container.setPosition(
        width - margin - this.width / 2,
        height / 2
      );
      return;
    }

    this.width = DESKTOP_SIZE.width * uiScale;
    this.height = DESKTOP_SIZE.height * uiScale;

    this.label.setFontSize(20 * uiScale);

    const bottomMargin = DESKTOP_BOTTOM_MARGIN * uiScale + safeArea.bottom;
    this.container.setPosition(width / 2, height - bottomMargin - this.height / 2);
  }
}
