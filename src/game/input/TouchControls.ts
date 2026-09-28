import Phaser from 'phaser';
import { CameraMode } from '../camera/CameraMode';
import { PALETTE } from '../config/Palette';
import type { CommandBus } from '../commands/CommandBus';
import type { GameState } from '../state/GameState';
import { TurnPhase } from '../state/TurnPhase';
import type { PlayerId } from '../state/ids';
import type { ViewportService } from '../platform/ViewportService';
import type { InputRouter } from './InputRouter';
import { MoveInputCore } from './MoveInputCore';
import type { InputSource } from './InputSource';
import type { GestureKind } from './gesture';

/**
 * 触屏控制档位适配器（Phase 6.5，CODELY.md §25）。
 *
 * 组成（与 DesktopControls 同一 InputSource 门面，Gameplay 完全一致）：
 * - 大号 ◀ / ▶ 按住移动按钮（UI zone —— 屏幕实体按钮永远先于世界手势；
 *   多指各自追踪，按住加速 / 松开即停，与键盘共用 MoveInputCore 手感曲线）
 * - 「己方 / 敌方」相机快捷聚焦按钮（UI zone，仅 FREE_VIEW 激活）
 * - 控制目标 = 当前回合玩家（Phase 8 热座）
 * - 布局遵守 Safe Area（刘海 / 手势条方向 insets）
 *
 * 真机修复（高分屏清晰渲染）：游戏坐标 = 物理像素，
 * 所有屏幕手感常量（按钮尺寸 / 字号 / 边距）经 uiScale（= DPR）换算，
 * CSS 观感跨设备恒定；尺寸随视口变化（含 DPR 变化）重算。
 *
 * 说明：按钮既是 HUD 也是输入采集器（按下状态即"按键状态"），
 * 按 CODELY.md §25 归入 Input Adapter 层；AimButton 这类纯 UI
 * （只触发相机流程，不产生命令）仍在 ui/。
 * 所有移动仍以 MoveCommand 走 CommandBus → MovementSystem 校验，
 * 输入层不含规则。
 */

/** 屏幕手感常量（CSS px，运行时 ×uiScale） */
const MOVE_BUTTON_SIZE = 88;
/** Phase 9 反馈 ②：聚焦按钮右下角 → 底部居中，尺寸缩小 2/3（72 → 24） */
const FOCUS_BUTTON_SIZE = 24;
const FOCUS_FONT = 10;
const EDGE_MARGIN = 20;
const GAP = 12;
const FOCUS_GAP = 8;
/** Phase 9 反馈 ②：◀/▶ 移动按钮常驻半透明（按下时抬亮提供反馈） */
const MOVE_BUTTON_ALPHA = 0.2;
const MOVE_BUTTON_PRESSED_ALPHA = 0.5;

interface TouchButton {
  id: string;
  kind: GestureKind;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  /** CSS px 基准尺寸（×uiScale 后为游戏像素尺寸） */
  baseSize: number;
  /** 游戏像素尺寸（zone 命中与绘制用） */
  width: number;
  height: number;
  /** 移动按钮方向（箭头重绘用） */
  direction: 'left' | 'right' | null;
  /** 移动按钮箭头 / 聚焦按钮文本（缩放重绘用） */
  arrow: Phaser.GameObjects.Graphics | null;
  text: Phaser.GameObjects.Text | null;
  /** 移动按钮当前按下视觉状态 */
  pressed: boolean;
  /** zone 是否可命中（聚焦按钮仅 FREE_VIEW） */
  enabled: boolean;
  /** 按住的 pointerId 集合（移动按钮多指追踪） */
  heldPointers: Set<number>;
}

export interface TouchControlsDeps {
  getState: () => GameState;
  commandBus: CommandBus;
  router: InputRouter;
  viewport: ViewportService;
  /** 点击「己方」聚焦（FREE_VIEW 内平移相机到当前玩家） */
  onFocusSelf: () => void;
  /** 点击「敌方」聚焦（平移相机到对方玩家） */
  onFocusEnemy: () => void;
  /** 聚焦按钮的激活条件（FREE_VIEW only） */
  getCameraMode: () => CameraMode;
}

export class TouchControls implements InputSource {
  private readonly scene: Phaser.Scene;
  private readonly deps: TouchControlsDeps;
  private readonly core: MoveInputCore;
  private readonly unsubscribeViewport: () => void;

  private leftButton!: TouchButton;
  private rightButton!: TouchButton;
  private focusSelfButton!: TouchButton;
  private focusEnemyButton!: TouchButton;
  /**
   * ◀ / ▶ 移动按钮可见（Phase 9 Review Gate：仅 ACTION 相位显示 ——
   * 点击「回到炮手 / 瞄准」即位置锁定并隐藏按钮，取消瞄准恢复）
   */
  private moveButtonsVisible = true;

  constructor(scene: Phaser.Scene, deps: TouchControlsDeps) {
    this.scene = scene;
    this.deps = deps;
    // 控制目标 = 当前回合玩家（Phase 8 热座）
    this.core = new MoveInputCore(
      () => deps.getState().currentPlayerId,
      deps.getState,
      deps.commandBus
    );

    this.leftButton = this.createHoldButton('touch-move-left', 'left');
    this.rightButton = this.createHoldButton('touch-move-right', 'right');
    this.focusSelfButton = this.createFocusButton(
      'touch-focus-self',
      '己方',
      () => deps.onFocusSelf()
    );
    this.focusEnemyButton = this.createFocusButton(
      'touch-focus-enemy',
      '敌方',
      () => deps.onFocusEnemy()
    );

    this.reposition();

    this.unsubscribeViewport = deps.viewport.onChange(() => {
      this.reposition();
    });
  }

  get playerId(): PlayerId {
    return this.core.playerId;
  }

  /** ◀ / ▶ 移动按钮当前是否显示（E2E / 调试观测用） */
  get isMoveButtonsVisible(): boolean {
    return this.moveButtonsVisible;
  }

  setEnabled(enabled: boolean): void {
    this.core.setEnabled(enabled);
  }

  update(deltaMs: number): void {
    const leftHeld = this.leftButton.heldPointers.size > 0;
    const rightHeld = this.rightButton.heldPointers.size > 0;
    this.core.setDirection(
      ((rightHeld ? 1 : 0) - (leftHeld ? 1 : 0)) as -1 | 0 | 1
    );
    this.core.update(deltaMs);
  }

  /**
   * 每帧由 BattleScene 驱动：
   * - 聚焦按钮仅在 FREE_VIEW 可用
   * - ◀ / ▶ 移动按钮仅 ACTION 相位显示（Phase 9 Review Gate：
   *   点击瞄准按钮后位置锁定 —— MovementSystem 同步拒绝 RETURN_HOME /
   *   AIM 移动；按钮隐藏 + zone 失活，取消瞄准回 ACTION 自动恢复）
   * - moveAllowed（Phase 14 联机）：对手回合 = false → 移动按钮隐藏
   *   （聚焦按钮保留 —— 对手回合仍允许 Free View 观察）；离线不传不变。
   */
  refresh(cameraMode: CameraMode, moveAllowed = true): void {
    const focusEnabled = cameraMode === CameraMode.FREE_VIEW;
    for (const button of [this.focusSelfButton, this.focusEnemyButton]) {
      if (button.enabled !== focusEnabled) {
        button.enabled = focusEnabled;
        this.drawFocusButton(button);
      }
    }

    const moveVisible =
      this.deps.getState().phase === TurnPhase.ACTION && moveAllowed;
    if (moveVisible !== this.moveButtonsVisible) {
      this.moveButtonsVisible = moveVisible;
      for (const button of [this.leftButton, this.rightButton]) {
        button.container.setVisible(moveVisible);
        if (!moveVisible) {
          // 隐藏即松手：清掉按住追踪，防止隐藏期间残留按压状态
          button.heldPointers.clear();
          button.pressed = false;
        }
        this.drawHoldButton(button);
      }
    }
  }

  destroy(): void {
    this.unsubscribeViewport();
    for (const button of this.allButtons()) {
      this.deps.router.unregisterZone(button.id);
      button.container.destroy();
      button.heldPointers.clear();
    }
    this.core.setEnabled(false);
  }

  // ---- 创建 ------------------------------------------------------------

  private createHoldButton(
    id: string,
    direction: 'left' | 'right'
  ): TouchButton {
    // kind = 'UI'：屏幕实体按钮永远先于世界手势（AIM 起始半径可能覆盖
    // 到按钮区域，按住按钮移动时绝不能被误判为开始瞄准）；
    // 语义产出是 MOVEMENT 命令，走 MoveInputCore → CommandBus。
    const button = this.createButton(id, 'UI', MOVE_BUTTON_SIZE, direction);
    button.arrow = this.scene.add.graphics();
    button.container.add(button.arrow);
    this.drawArrow(button);
    this.drawHoldButton(button);
    this.registerHoldZone(button);
    return button;
  }

  private createFocusButton(
    id: string,
    label: string,
    onTap: () => void
  ): TouchButton {
    const button = this.createButton(id, 'UI', FOCUS_BUTTON_SIZE, null);
    button.text = this.scene.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0.5);
    button.container.add(button.text);
    button.enabled = false; // 初始 FREE_VIEW 前不可用（refresh 会驱动）
    this.drawFocusButton(button);

    this.deps.router.registerZone({
      id: button.id,
      kind: button.kind,
      isActive: () => button.enabled,
      contains: (x, y) => containsButton(button, x, y),
      onDown: () => onTap(),
    });
    return button;
  }

  private createButton(
    id: string,
    kind: GestureKind,
    baseSize: number,
    direction: 'left' | 'right' | null
  ): TouchButton {
    const container = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(900);
    const bg = this.scene.add.graphics();
    container.add(bg);

    return {
      id,
      kind,
      container,
      bg,
      baseSize,
      width: baseSize,
      height: baseSize,
      direction,
      arrow: null,
      text: null,
      pressed: false,
      enabled: true,
      heldPointers: new Set<number>(),
    };
  }

  // ---- 绘制 ------------------------------------------------------------

  private drawArrow(button: TouchButton): void {
    if (!button.arrow || !button.direction) {
      return;
    }
    const ui = this.deps.viewport.current.uiScale;
    const arrow = button.arrow;
    arrow.clear();
    const half = button.width / 2 - 22 * ui;
    const tipX = button.direction === 'left' ? -half : half;
    const baseX = button.direction === 'left' ? half : -half;
    arrow.fillStyle(0xe8eef7, 0.95);
    arrow.fillTriangle(tipX, 0, baseX, -half * 0.75, baseX, half * 0.75);
  }

  private drawHoldButton(button: TouchButton): void {
    const { width, height, pressed } = button;
    const ui = this.deps.viewport.current.uiScale;
    const accent = PALETTE.P1;
    const radius = 16 * ui;
    button.bg.clear();
    button.bg.fillStyle(0x0d1420, 0.75);
    button.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    button.bg.fillStyle(accent, pressed ? 0.85 : 0.35);
    button.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    button.bg.lineStyle(2 * ui, accent, pressed ? 1 : 0.7);
    button.bg.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
    // Phase 9 反馈 ②：常驻半透明，按下抬亮（反馈仍在但不再抢视觉）
    button.container.setAlpha(pressed ? MOVE_BUTTON_PRESSED_ALPHA : MOVE_BUTTON_ALPHA);
  }

  private drawFocusButton(button: TouchButton): void {
    const { width, height, enabled } = button;
    const ui = this.deps.viewport.current.uiScale;
    const accent = button.id === 'touch-focus-self' ? PALETTE.P1 : PALETTE.P2;
    const radius = width / 2;
    button.bg.clear();
    button.bg.fillStyle(0x0d1420, 0.75);
    button.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    button.bg.fillStyle(accent, enabled ? 0.5 : 0.12);
    button.bg.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    button.bg.lineStyle(2 * ui, accent, enabled ? 0.9 : 0.25);
    button.bg.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
    button.container.setAlpha(enabled ? 1 : 0.5);
  }

  // ---- 布局（Safe Area + uiScale） ---------------------------------------

  private reposition(): void {
    const { width, height, safeArea, uiScale } = this.deps.viewport.current;

    // 尺寸重算（DPR 变化时按钮需重绘）
    for (const button of this.allButtons()) {
      const size = button.baseSize * uiScale;
      if (button.width !== size) {
        button.width = size;
        button.height = size;
        if (button.arrow) {
          this.drawArrow(button);
        }
        if (button.text) {
          button.text.setFontSize(FOCUS_FONT * uiScale);
        }
        if (button.direction) {
          this.drawHoldButton(button);
        } else {
          this.drawFocusButton(button);
        }
      }
    }

    // 左下：◀ ▶ 移动按钮
    const edge = EDGE_MARGIN * uiScale;
    const gap = GAP * uiScale;
    const moveBottom = height - safeArea.bottom - edge;
    const leftX = safeArea.left + edge + this.leftButton.width / 2;
    this.leftButton.container.setPosition(
      leftX,
      moveBottom - this.leftButton.height / 2
    );
    this.rightButton.container.setPosition(
      leftX + this.leftButton.width + gap,
      this.leftButton.container.y
    );

    // 底部居中：己方 / 敌方 聚焦按钮（Phase 9 反馈 ②：右下角移中缩小）
    const focusBottom = height - safeArea.bottom - edge;
    const focusGap = FOCUS_GAP * uiScale;
    const pairWidth =
      this.focusSelfButton.width + focusGap + this.focusEnemyButton.width;
    const pairLeft = width / 2 - pairWidth / 2;
    this.focusSelfButton.container.setPosition(
      pairLeft + this.focusSelfButton.width / 2,
      focusBottom - this.focusSelfButton.height / 2
    );
    this.focusEnemyButton.container.setPosition(
      pairLeft + pairWidth - this.focusEnemyButton.width / 2,
      focusBottom - this.focusEnemyButton.height / 2
    );
  }

  private allButtons(): TouchButton[] {
    return [
      this.leftButton,
      this.rightButton,
      this.focusSelfButton,
      this.focusEnemyButton,
    ];
  }

  // ---- zone 事件（hold 按钮） -------------------------------------------

  /** hold 按钮的 zone：按下开始按住，抬起 / 打断结束；随可见性失活 */
  private registerHoldZone(button: TouchButton): void {
    this.deps.router.registerZone({
      id: button.id,
      kind: button.kind,
      isActive: () => this.moveButtonsVisible,
      contains: (x, y) => containsButton(button, x, y),
      onDown: (event) => {
        button.heldPointers.add(event.pointerId);
        button.pressed = true;
        this.drawHoldButton(button);
      },
      onUp: (event) => {
        button.heldPointers.delete(event.pointerId);
        button.pressed = button.heldPointers.size > 0;
        this.drawHoldButton(button);
      },
      onCancel: (event) => {
        button.heldPointers.delete(event.pointerId);
        button.pressed = button.heldPointers.size > 0;
        this.drawHoldButton(button);
      },
    });
  }
}

function containsButton(
  button: TouchButton,
  x: number,
  y: number
): boolean {
  const cx = button.container.x;
  const cy = button.container.y;
  return (
    x >= cx - button.width / 2 &&
    x <= cx + button.width / 2 &&
    y >= cy - button.height / 2 &&
    y <= cy + button.height / 2
  );
}
