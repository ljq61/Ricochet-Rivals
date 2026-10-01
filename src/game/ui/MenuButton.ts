import Phaser from 'phaser';
import type { ViewportService } from '../platform/ViewportService';
import type { InputRouter } from '../input/InputRouter';
import { ART } from '../config/ArtAssets';

/** 屏幕手感常量（CSS px，运行时 ×uiScale）；默认高度 64；紧凑图标保持 48 触控目标下限 */
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 64;
const FONT_SIZE = 22;
/** 9-slice 底板启用阈值（CSS px）：小件（48px icon）切片退化，保持程序绘制 */
const ART_MIN_WIDTH = 150;

export interface MenuButtonDeps {
  /** 手势路由（与 Battle HUD 同一管线：UI zone 优先级、坐标已归一化到画布空间、统一鼠标/触摸） */
  router: InputRouter;
  /** zone 唯一 id（unregister 用） */
  id: string;
  viewport: ViewportService;
  /** 按钮文案（构建后可用 setLabel 更新，如 SOUND: ON/OFF） */
  label: string;
  accent?: number;
  baseWidth?: number;
  baseHeight?: number;
  fontSize?: number;
  icon?: 'sound' | 'fullscreen';
  /** 联机菜单使用与海港 HUD 一致的铆钉金属牌；其余菜单沿用原素材。 */
  skin?: 'harbor';
  harborIcon?: 'network' | 'create' | 'join' | 'copy' | 'retry' | 'battle' | 'back';
  onTap: () => void;
}

export interface ButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 菜单大按钮（Phase 11）：Graphics 药丸 + 居中文本。
 *
 * 命中走 InputRouter zone（UI 最高优先级）——与 Battle 场景 HUD 按钮同一
 * 输入管线：window 级 Pointer Events 统一鼠标/触摸、client→画布坐标
 * 归一化（真机修复后的正确路径）、pointercancel/blur 安全释放。
 * （不使用 Phaser GameObject setInteractive：本项目 Scale.NONE + 手动
 * canvas 样式配置下 Phaser input 的指针坐标管线不可用，实测 worldX/Y=0。）
 *
 * 触屏：按下即触发 + pressed 高亮（不依赖 hover）；桌面：hover 追加高亮。
 * 尺寸 / 字号经 uiScale（= DPR）；rect() 供场景 debug 句柄输出 E2E 坐标。
 */
export class MenuButton {
  private readonly deps: MenuButtonDeps;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  /** 真机反馈轮：生成底板图（金/钢）；素材缺失或小件 = null 走 Graphics。
   *  注：试过 NineSlice —— Phaser 4 语义与预期不符（实测渲染 2.5 倍超标），
   *  改用 Image 等比显示：素材自带上下透明边距，可见药丸反而更紧凑 */
  private readonly art: Phaser.GameObjects.Image | null;
  private readonly label: Phaser.GameObjects.Text;
  private width: number;
  private baseWidth: number;
  private height: number;
  private hovered = false;
  private iconActive = false;
  /** 可见性驱动 zone 命中：不可见 = 不可点（防止重叠布局下不可见按钮抢走点击） */
  private visible = true;
  private readonly unsubscribeViewport: () => void;

  constructor(scene: Phaser.Scene, deps: MenuButtonDeps) {
    this.deps = deps;

    const baseWidth = deps.baseWidth ?? DEFAULT_WIDTH;
    this.baseWidth = baseWidth;
    const artKey = deps.accent === undefined ? ART.buttonGold : ART.buttonSteel;
    this.art =
      deps.skin !== 'harbor' && baseWidth >= ART_MIN_WIDTH && scene.textures.exists(artKey)
        ? scene.add.image(0, 0, artKey)
        : null;

    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, deps.label, {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0.5);
    this.container = scene.add
      .container(0, 0, this.art ? [this.art, this.label] : [this.bg, this.label])
      .setDepth(900);

    this.width = baseWidth;
    this.height = deps.baseHeight ?? DEFAULT_HEIGHT;

    deps.router.registerZone({
      id: deps.id,
      kind: 'UI',
      isActive: () => this.visible,
      contains: (x, y) => this.contains(x, y),
      onDown: () => {
        // 按下即触发（菜单语义）：pressed 反馈闪现一拍后由动作接管
        this.pressed = true;
        this.draw();
        deps.onTap();
        this.pressed = false;
        this.draw();
      },
      onHover: (inside) => {
        this.hovered = inside;
        this.draw();
      },
    });

    this.unsubscribeViewport = deps.viewport.onChange(() => {
      this.applyScale();
      this.setPosition(this.container.x, this.container.y);
    });
    this.applyScale();
  }

  private pressed = false;

  setLabel(text: string): void {
    this.label.setText(text);
    this.draw();
  }

  setIconActive(active: boolean): void {
    this.iconActive = active;
    this.draw();
  }

  /** 当前命中区中心（物理像素，场景布局后有效；E2E ÷uiScale 得 CSS 坐标） */
  rect(): ButtonRect {
    return {
      x: this.container.x,
      y: this.container.y,
      width: this.width,
      height: this.height,
    };
  }

  /** 中心定位（物理像素；场景负责 Safe Area 计算） */
  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  /** Responsive action rows share the same visual and touch width. */
  setBaseWidth(width: number): void {
    if (this.baseWidth === width) return;
    this.baseWidth = width;
    this.applyScale();
  }

  /** 显隐（场景按状态驱动 UI 页面组合）；不可见时 zone 同步失活 */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.setVisible(visible);
  }

  destroy(): void {
    this.unsubscribeViewport();
    this.deps.router.unregisterZone(this.deps.id);
    this.container.destroy();
  }

  private contains(x: number, y: number): boolean {
    return (
      Math.abs(x - this.container.x) <= this.width / 2 &&
      Math.abs(y - this.container.y) <= this.height / 2
    );
  }

  private applyScale(): void {
    const ui = this.deps.viewport.current.uiScale;
    this.width = this.baseWidth * ui;
    this.height = (this.deps.baseHeight ?? DEFAULT_HEIGHT) * ui;
    this.label.setFontSize((this.deps.fontSize ?? FONT_SIZE) * ui);
    if (this.art !== null) {
      // 生成底板：等比铺满命中区（素材自带透明边距 → 可见药丸 ~70% 高）
      this.art.setDisplaySize(this.width, this.height);
    }
    this.draw();
  }

  private draw(): void {
    const ui = this.deps.viewport.current.uiScale;
    if (this.deps.skin === 'harbor') {
      this.drawHarborButton(ui);
      return;
    }
    if (this.art !== null) {
      // 生成底板路径：按下压暗一拍（label 色 / 加粗沿用现有逻辑）
      this.art.setTint(this.pressed ? 0xcfcfcf : 0xffffff);
      this.label.setColor(this.deps.accent === undefined ? '#151c22' : '#fff4db');
      this.label.setFontStyle('bold');
      return;
    }
    const accent = this.deps.accent ?? 0xf3a725;
    const radius = 4 * ui;
    const { width, height } = this;

    this.bg.clear();
    this.bg.fillStyle(0x080d12, 1);
    this.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    const active = this.pressed || this.hovered;
    this.bg.fillStyle(accent, this.pressed ? 0.65 : active ? 1 : 0.88);
    this.bg.fillRoundedRect(-width / 2 + 4 * ui, -height / 2 + 4 * ui, width - 8 * ui, height - 8 * ui, radius);
    this.bg.lineStyle(2 * ui, active ? 0xffe19a : 0xb4b6ad, 1);
    this.bg.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.bg.lineStyle(2 * ui, 0xffe19a, 0.55);
    this.bg.lineBetween(-width / 2 + 10 * ui, -height / 2 + 7 * ui, width / 2 - 10 * ui, -height / 2 + 7 * ui);
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        this.bg.fillStyle(0x151c22);
        this.bg.fillCircle(x * (width / 2 - 10 * ui), y * (height / 2 - 10 * ui), 2.5 * ui);
      }
    }
    this.label.setColor(this.deps.accent === undefined ? '#151c22' : '#fff4db');
    this.label.setFontStyle('bold');
    if (this.deps.icon) {
      this.label.setVisible(false);
      this.drawIcon(ui);
    }
  }

  /** 深海蓝嵌板、黄铜/钢框、切角与铆钉；绘制边界和输入尺寸一致。 */
  private drawHarborButton(ui: number): void {
    const g = this.bg;
    const { width, height } = this;
    const gold = this.deps.accent === undefined;
    const active = this.hovered || this.pressed;
    const rim = gold ? 0xc8913f : 0x718b99;
    const highlight = gold ? 0xffdfa0 : 0xd8edf2;
    const compact = this.baseWidth < 100;
    const plate = (inset: number, color: number): void => {
      const x = width / 2 - inset, y = height / 2 - inset, cut = 6 * ui;
      g.fillStyle(color, 1).beginPath().moveTo(-x + cut, -y)
        .lineTo(x - cut, -y).lineTo(x, -y + cut).lineTo(x, y - cut)
        .lineTo(x - cut, y).lineTo(-x + cut, y).lineTo(-x, y - cut)
        .lineTo(-x, -y + cut).closePath().fillPath();
    };
    g.clear();
    plate(0, 0x091520);
    plate(2 * ui, active ? highlight : rim);
    plate(5 * ui, this.pressed ? 0x122938 : active ? 0x24526a : 0x193c4d);
    g.lineStyle(ui, highlight, 0.8)
      .lineBetween(-width / 2 + 9 * ui, -height / 2 + 3 * ui, width / 2 - 9 * ui, -height / 2 + 3 * ui);
    g.lineStyle(2 * ui, 0x070f19, 0.7)
      .lineBetween(-width / 2 + 9 * ui, height / 2 - 3 * ui, width / 2 - 9 * ui, height / 2 - 3 * ui);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx * (width / 2 - 10 * ui), y = sy * (height / 2 - 10 * ui);
        g.fillStyle(0x091520).fillCircle(x, y, 3 * ui);
        g.fillStyle(highlight, 0.85).fillCircle(x - 0.5 * ui, y - 0.5 * ui, 1.5 * ui);
      }
    }
    const emblemX = compact ? 0 : -width / 2 + 34 * ui;
    if (!compact) {
      g.fillStyle(0x0b2230, 1).fillRoundedRect(emblemX - 17 * ui, -17 * ui, 34 * ui, 34 * ui, 4 * ui);
      g.lineStyle(ui, rim, 0.85).strokeRoundedRect(emblemX - 17 * ui, -17 * ui, 34 * ui, 34 * ui, 4 * ui);
      g.lineStyle(ui, rim, 0.55).lineBetween(-width / 2 + 61 * ui, -height / 2 + 11 * ui,
        -width / 2 + 61 * ui, height / 2 - 11 * ui);
    }
    this.drawHarborIcon(emblemX, ui, highlight);
    this.label.setVisible(!compact).setX(compact ? 0 : 24 * ui)
      .setFontFamily('Arial, sans-serif').setFontStyle('bold')
      .setFontSize((this.deps.fontSize ?? FONT_SIZE) * ui)
      .setColor(gold ? '#fff1cc' : '#e1eef2').setStroke('#091520', 2 * ui);
    const textWidth = width - 96 * ui;
    if (!compact && this.label.width > textWidth) {
      this.label.setFontSize(Math.max(12 * ui,
        (this.deps.fontSize ?? FONT_SIZE) * ui * textWidth / this.label.width));
    }
  }

  /** 小图标与金属边框共用坐标，不依赖字体箭头或新增位图。 */
  private drawHarborIcon(x: number, ui: number, color: number): void {
    const g = this.bg;
    const line = (ax: number, ay: number, bx: number, by: number): void => {
      g.lineBetween(x + ax * ui, ay * ui, x + bx * ui, by * ui);
    };
    g.lineStyle(2.5 * ui, color, 1);
    const symbol = this.deps.harborIcon ?? 'network';
    if (symbol === 'back') {
      line(12, 0, -12, 0); line(-12, 0, -2, -10); line(-12, 0, -2, 10);
    } else if (symbol === 'create') {
      g.strokeRoundedRect(x - 11 * ui, -11 * ui, 22 * ui, 22 * ui, 3 * ui);
      line(-6, 0, 6, 0); line(0, -6, 0, 6);
    } else if (symbol === 'join') {
      line(3, -11, 11, -11); line(11, -11, 11, 11); line(11, 11, 3, 11);
      line(-12, 0, 5, 0); line(5, 0, -1, -6); line(5, 0, -1, 6);
    } else if (symbol === 'copy') {
      g.strokeRoundedRect(x - 5 * ui, -6 * ui, 15 * ui, 18 * ui, 2 * ui);
      line(-9, 7, -12, 7); line(-12, 7, -12, -12); line(-12, -12, 4, -12);
    } else if (symbol === 'retry') {
      g.beginPath().arc(x, 0, 10 * ui, -0.7, Math.PI * 1.4).strokePath();
      line(8, -7, 8, -14); line(8, -7, 1, -8);
    } else if (symbol === 'battle') {
      line(-10, -11, 10, 11); line(10, -11, -10, 11);
      line(-12, 5, -5, 12); line(5, 12, 12, 5);
    } else {
      line(-10, -7, 10, -7); line(-10, -7, 0, 10); line(10, -7, 0, 10);
      for (const [dx, dy] of [[-10, -7], [10, -7], [0, 10]] as const) {
        g.fillStyle(0x0b2230).fillCircle(x + dx * ui, dy * ui, 4 * ui);
        g.lineStyle(2 * ui, color).strokeCircle(x + dx * ui, dy * ui, 4 * ui);
      }
    }
  }

  /** Code-native pictograms stay crisp at every DPR; state is never encoded only by color. */
  private drawIcon(ui: number): void {
    const g = this.bg;
    g.lineStyle(2.5 * ui, 0xffedbd, 1);
    if (this.deps.icon === 'sound') {
      g.fillStyle(0xffedbd);
      g.fillRect(-11 * ui, -4 * ui, 6 * ui, 8 * ui);
      g.fillTriangle(-6 * ui, -4 * ui, 2 * ui, -10 * ui, 2 * ui, 10 * ui);
      g.fillTriangle(-6 * ui, -4 * ui, -6 * ui, 4 * ui, 2 * ui, 10 * ui);
      if (this.iconActive) {
        for (const radius of [7, 12]) {
          g.beginPath().arc(2 * ui, 0, radius * ui, -0.85, 0.85).strokePath();
        }
      } else {
        g.lineStyle(3 * ui, 0xf47b65).lineBetween(-12 * ui, 12 * ui, 13 * ui, -12 * ui);
      }
    } else {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const corner = this.iconActive ? 5 : 11;
          const end = this.iconActive ? 12 : 4;
          g.lineBetween(sx * corner * ui, sy * corner * ui, sx * end * ui, sy * corner * ui);
          g.lineBetween(sx * corner * ui, sy * corner * ui, sx * corner * ui, sy * end * ui);
        }
      }
    }
  }
}
