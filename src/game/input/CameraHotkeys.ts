import Phaser from 'phaser';

export interface CameraHotkeysHandlers {
  /** Space / 按钮：发起瞄准（相机流程自行判断当前模式是否允许） */
  onAimRequest: () => void;
  /** Esc / 鼠标右键：取消瞄准 */
  onAimCancel: () => void;
}

/**
 * 相机快捷键（CODELY.md §9 Desktop shortcut）：
 * - Space → 发起瞄准（回到炮手）
 * - Escape / 鼠标右键 → 取消瞄准，回到自由观察
 * - 禁用 Canvas 右键菜单（右键是游戏操作）
 */
export class CameraHotkeys {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly handlers: CameraHotkeysHandlers
  ) {
    const keyboard = scene.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-SPACE', handlers.onAimRequest);
      keyboard.on('keydown-ESC', handlers.onAimCancel);
    }

    // 右键是取消操作，禁用浏览器右键菜单
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', this.onPointerDown);
  }

  destroy(): void {
    // 场景关闭链中 scene.input 可能已置 null（SHUTDOWN 时序）——防御
    const keyboard = this.scene.input?.keyboard;
    if (keyboard) {
      keyboard.off('keydown-SPACE', this.handlers.onAimRequest);
      keyboard.off('keydown-ESC', this.handlers.onAimCancel);
    }
    this.scene.input?.off('pointerdown', this.onPointerDown);
  }

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.rightButtonDown()) {
      this.handlers.onAimCancel();
    }
  };
}
