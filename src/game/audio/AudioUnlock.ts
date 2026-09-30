/** The Web Audio part of Phaser's game-wide sound manager. */
interface AudioUnlockManager {
  context?: { readonly state: string; resume(): Promise<void> };
  locked?: boolean;
  unlocked?: boolean;
}

/**
 * Unlock in the native gesture stack, before InputRouter starts a scene change.
 * Phaser removes its initial unlock listeners even when resume rejects. Keep ours
 * for later gestures and iOS's interrupted context after an app switch.
 * Resuming creates no sound: SfxBus still owns the user's mute preference.
 */
export class AudioUnlock {
  private interacted = false;
  private destroyed = false;
  private readonly gestureEvents = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;

  constructor(
    private readonly sound: AudioUnlockManager,
    private readonly eventDocument: Document = document,
    private readonly eventWindow: Window = window
  ) {
    // HTML5Audio / NoAudio keep Phaser's own behavior.
    if (!sound.context) return;
    for (const name of this.gestureEvents) {
      eventDocument.addEventListener(name, this.onGesture, true);
    }
    eventDocument.addEventListener('visibilitychange', this.onReturn);
    eventWindow.addEventListener('focus', this.onReturn);
    eventWindow.addEventListener('pageshow', this.onReturn);
  }

  destroy(): void {
    this.destroyed = true;
    for (const name of this.gestureEvents) {
      this.eventDocument.removeEventListener(name, this.onGesture, true);
    }
    this.eventDocument.removeEventListener('visibilitychange', this.onReturn);
    this.eventWindow.removeEventListener('focus', this.onReturn);
    this.eventWindow.removeEventListener('pageshow', this.onReturn);
  }

  private readonly onGesture = (): void => {
    this.interacted = true;
    this.resume();
  };

  private readonly onReturn = (): void => {
    if (this.interacted && this.eventDocument.visibilityState === 'visible') this.resume();
  };

  private resume(): void {
    const context = this.sound.context;
    if (this.destroyed || !context || context.state === 'closed') return;
    const finish = (): void => {
      if (!this.destroyed && context === this.sound.context && context.state === 'running' && this.sound.locked) {
        // Let Phaser emit UNLOCKED and clear locked on its next update.
        this.sound.unlocked = true;
      }
    };
    if (context.state === 'running') {
      finish();
      return;
    }
    try {
      // Do not defer or await before resume. Also do not deduplicate gestures:
      // pointerdown's pending resume may need pointerup/touchend activation.
      void context.resume().then(finish, () => {});
    } catch {
      // A later gesture can retry a rejected/interrupted context.
    }
  }
}
