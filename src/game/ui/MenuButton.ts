import Phaser from 'phaser';
import type { ViewportService } from '../platform/ViewportService';
import type { InputRouter } from '../input/InputRouter';

/** 屏幕手感常量（CSS px，运行时 ×uiScale）；高度 64 ≥ 56 触控目标下限 */
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 64;
const FONT_SIZE = 22;

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
  private readonly label: Phaser.GameObjects.Text;
  private width: number;
  private height: number;
  private hovered = false;
  /** 可见性驱动 zone 命中：不可见 = 不可点（防止重叠布局下不可见按钮抢走点击） */
  private visible = true;
  private readonly unsubscribeViewport: () => void;

  constructor(scene: Phaser.Scene, deps: MenuButtonDeps) {
    this.deps = deps;

    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, deps.label, {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0.5);
    this.container = scene.add
      .container(0, 0, [this.bg, this.label])
      .setDepth(900);

    this.width = deps.baseWidth ?? DEFAULT_WIDTH;
    this.height = DEFAULT_HEIGHT;

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
    this.width = (this.deps.baseWidth ?? DEFAULT_WIDTH) * ui;
    this.height = DEFAULT_HEIGHT * ui;
    this.label.setFontSize(FONT_SIZE * ui);
    this.draw();
  }

  private draw(): void {
    const ui = this.deps.viewport.current.uiScale;
    const accent = this.deps.accent ?? 0x3f8cff;
    const radius = 12 * ui;
    const { width, height } = this;

    this.bg.clear();
    this.bg.fillStyle(0x0d1420, 0.85);
    this.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    const active = this.pressed || this.hovered;
    this.bg.fillStyle(accent, this.pressed ? 0.85 : active ? 0.95 : 0.7);
    this.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.bg.lineStyle(2 * ui, accent, active ? 1 : 0.75);
    this.bg.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
  }
}
