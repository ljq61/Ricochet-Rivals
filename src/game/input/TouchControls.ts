import Phaser from 'phaser';
import { CameraMode } from '../camera/CameraMode';
import { PALETTE, playerColor } from '../config/Palette';
import { baseDockGeometry } from '../systems/WorldBuilder';
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
const MOVE_BUTTON_SIZE = 48;
/** Phase 9 反馈 ②：聚焦按钮右下角 → 底部居中，尺寸缩小 2/3（72 → 24）
 *  —— 视觉保持 24；Phase 18 Step 8 触控下限：命中区单独扩至 ≥48 CSS px */
const FOCUS_BUTTON_SIZE = 24;
/** Phase 18 Step 8：触控目标命中区下限（视觉可以小，命中区不能小） */
const FOCUS_HIT_MIN = 48;
const FOCUS_FONT = 10;
const EDGE_MARGIN = 20;
const GAP = 10;
/** 48px 命中区不互相重叠所需的最小中心距（视觉 24 + 间 24 = 48） */
const FOCUS_GAP = 24;

interface TouchButton {
  id: string;
  kind: GestureKind;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  /** CSS px 基准尺寸（×uiScale 后为游戏像素尺寸） */
  baseSize: number;
  /** 游戏像素尺寸（绘制用） */
  width: number;
  height: number;
  /** 游戏像素命中区尺寸（zone contains 用；≥ 视觉尺寸，聚焦钮达 48 CSS px 下限） */
  hitWidth: number;
  hitHeight: number;
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
  /** 画面坐标（相机缩放补偿前）；InputRouter 的 zone 直接使用此坐标。 */
  screenX: number;
  screenY: number;
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
  private lastVisualPlayerId: PlayerId | null = null;

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

  /** 可见按钮中心（游戏像素，供触控回归测试取真实落点）。 */
  get moveButtonCenters(): { left: { x: number; y: number }; right: { x: number; y: number } } {
    return {
      left: { x: this.leftButton.screenX, y: this.leftButton.screenY },
      right: { x: this.rightButton.screenX, y: this.rightButton.screenY },
    };
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
    this.repositionMoveButtons();
    const visualPlayerId = this.deps.getState().currentPlayerId;
    if (visualPlayerId !== this.lastVisualPlayerId) {
      this.lastVisualPlayerId = visualPlayerId;
      this.drawHoldButton(this.leftButton);
      this.drawHoldButton(this.rightButton);
    }
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
      hitWidth: baseSize,
      hitHeight: baseSize,
      direction,
      arrow: null,
      text: null,
      pressed: false,
      enabled: true,
      heldPointers: new Set<number>(),
      screenX: 0,
      screenY: 0,
    };
  }

  // ---- 绘制 ------------------------------------------------------------

  private drawArrow(button: TouchButton): void {
    if (!button.arrow || !button.direction) {
      return;
    }
    const arrow = button.arrow;
    arrow.clear();
    const half = button.width * 0.29;
    const tipX = button.direction === 'left' ? -half : half;
    const baseX = button.direction === 'left' ? half : -half;
    arrow.fillStyle(0xe8eef7, 0.95);
    arrow.fillTriangle(tipX, 0, baseX, -half * 0.75, baseX, half * 0.75);
  }

  private drawHoldButton(button: TouchButton): void {
    const { width, pressed } = button;
    const ui = this.deps.viewport.current.uiScale;
    const accent = playerColor(this.deps.getState().currentPlayerId);
    // 实体金属控制盘：背景不透，队伍色外环；按压亮起内圈。
    const r = width / 2;
    button.bg.clear();
    button.bg.fillStyle(0x0b111a, 1);
    button.bg.fillCircle(0, 0, r);
    button.bg.fillStyle(0x233547, 1);
    button.bg.fillCircle(0, 0, r - 4 * ui);
    button.bg.fillStyle(pressed ? accent : 0x172331, pressed ? 0.8 : 1);
    button.bg.fillCircle(0, 0, r - 9 * ui);
    if (pressed) {
      button.bg.fillStyle(0xffffff, 0.15);
      button.bg.fillCircle(0, 0, r - 12 * ui);
    }
    button.bg.lineStyle(3 * ui, accent, 1).strokeCircle(0, 0, r - 2 * ui);
    button.container.setAlpha(1);
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
      // Phase 18 Step 8：命中区 ≥48 CSS px（聚焦钮视觉 24 保持不变；
      // 中心距 48（FOCUS_GAP）保证相邻命中区不重叠）
      const hit = button.direction
        ? size
        : Math.max(size, FOCUS_HIT_MIN * uiScale);
      button.hitWidth = hit;
      button.hitHeight = hit;
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

    const edge = EDGE_MARGIN * uiScale;
    this.repositionMoveButtons();

    // 底部居中：己方 / 敌方 聚焦按钮（Phase 9 反馈 ②：右下角移中缩小）
    const focusBottom = height - safeArea.bottom - edge;
    const focusGap = FOCUS_GAP * uiScale;
    const pairWidth =
      this.focusSelfButton.width + focusGap + this.focusEnemyButton.width;
    const pairLeft = width / 2 - pairWidth / 2;
    this.placeOnScreen(this.focusSelfButton,
      pairLeft + this.focusSelfButton.width / 2,
      focusBottom - this.focusSelfButton.height / 2
    );
    this.placeOnScreen(this.focusEnemyButton,
      pairLeft + pairWidth - this.focusEnemyButton.width / 2,
      focusBottom - this.focusEnemyButton.height / 2
    );
  }

  /** 当前回合基地正下方的双方向盘；相机平移时跟随其投影，离屏时贴边保留可操作性。 */
  private repositionMoveButtons(): void {
    const { width, height, safeArea, uiScale, zoom } = this.deps.viewport.current;
    const camera = this.scene.cameras.main;
    const playerId = this.deps.getState().currentPlayerId;
    const { center, dockWidth } = baseDockGeometry(playerId);
    const controlWorldX = center + (playerId === 'P1' ? -0.26 : 0.26) * dockWidth;
    const baseScreenX = width / 2 + (controlWorldX - camera.scrollX - width / 2) * zoom;
    const halfPair = (MOVE_BUTTON_SIZE + GAP / 2) * uiScale;
    const margin = EDGE_MARGIN * uiScale;
    const focusReserve = (FOCUS_HIT_MIN + 8) * uiScale;
    const pairMin = playerId === 'P1'
      ? safeArea.left + margin + halfPair
      : Math.max(safeArea.left + margin + halfPair, width / 2 + halfPair + focusReserve);
    const pairMax = playerId === 'P1'
      ? Math.min(width - safeArea.right - margin - halfPair, width / 2 - halfPair - focusReserve)
      : width - safeArea.right - margin - halfPair;
    const pairX = Phaser.Math.Clamp(baseScreenX, pairMin, pairMax);
    const y = height - safeArea.bottom - 4 * uiScale - this.leftButton.height / 2;
    const buttonOffset = (MOVE_BUTTON_SIZE + GAP) * uiScale / 2;
    this.placeOnScreen(this.leftButton, pairX - buttonOffset, y);
    this.placeOnScreen(this.rightButton, pairX + buttonOffset, y);
  }

  /** setScrollFactor(0) 仍受世界相机 zoom 影响；逆变换保证画面与命中区重合。 */
  private placeOnScreen(button: TouchButton, x: number, y: number): void {
    const { width, height, zoom } = this.deps.viewport.current;
    button.screenX = x;
    button.screenY = y;
    button.container.setScale(1 / zoom).setPosition(
      width / 2 + (x - width / 2) / zoom,
      height / 2 + (y - height / 2) / zoom,
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
  const cx = button.screenX;
  const cy = button.screenY;
  // 命中区（hitWidth/hitHeight ≥ 视觉尺寸；聚焦钮扩至 48 CSS px 下限）
  return (
    x >= cx - button.hitWidth / 2 &&
    x <= cx + button.hitWidth / 2 &&
    y >= cy - button.hitHeight / 2 &&
    y <= cy + button.hitHeight / 2
  );
}
