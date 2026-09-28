import type Phaser from 'phaser';
import type { CommandBus } from '../commands/CommandBus';
import type { GameState } from '../state/GameState';
import { KeyboardMoveInput } from './KeyboardMoveInput';
import { CameraHotkeys, type CameraHotkeysHandlers } from './CameraHotkeys';
import type { InputSource } from './InputSource';

/**
 * 桌面控制档位适配器（Phase 6.5；Phase 8 起跟随当前回合玩家）。
 *
 * 桌面平台的输入集合：
 * - KeyboardMoveInput：A / D / ← / → 移动（MoveCommand 走共享核心）
 * - CameraHotkeys：Space 发起瞄准、Esc / 右键取消
 * - 鼠标瞄准 / 相机拖拽不在此处 —— AimController / CameraController
 *   作为 GestureClaimant 由 InputRouter 统一调度，两端共用
 *
 * 实现与 TouchControls 相同的 InputSource 门面，
 * BattleScene 按 DeviceProfile 选择其一，Gameplay 完全一致。
 */
export class DesktopControls implements InputSource {
  private readonly keyboardMove: KeyboardMoveInput;
  private readonly hotkeys: CameraHotkeys;

  constructor(
    scene: Phaser.Scene,
    options: {
      getState: () => GameState;
      commandBus: CommandBus;
      hotkeys: CameraHotkeysHandlers;
    }
  ) {
    this.keyboardMove = new KeyboardMoveInput(
      scene,
      options.getState,
      options.commandBus
    );
    this.hotkeys = new CameraHotkeys(scene, options.hotkeys);
  }

  get playerId() {
    return this.keyboardMove.playerId;
  }

  setEnabled(enabled: boolean): void {
    this.keyboardMove.setEnabled(enabled);
  }

  update(deltaMs: number): void {
    this.keyboardMove.update(deltaMs);
  }

  destroy(): void {
    this.keyboardMove.destroy();
    this.hotkeys.destroy();
  }
}
