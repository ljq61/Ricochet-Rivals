import { getUserSettings, toggleSound } from '../settings/UserSettings';

export interface BattleSettingsOptions {
  onOpenChange: (open: boolean) => void;
  onLeave: () => void;
  onSoundChange?: (enabled: boolean) => void;
}

type SettingsPhase = 'closed' | 'settings' | 'confirm';
type Action = 'gear' | 'sound' | 'leave' | 'resume' | 'cancel' | 'confirm';

/** DOM controls use CSS pixels independently of the canvas DPR and block game gestures. */
export class BattleSettings {
  private readonly root = document.createElement('div');
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly settings: HTMLElement;
  private readonly confirmation: HTMLElement;
  private readonly buttons: Record<Action, HTMLButtonElement>;
  private currentPhase: SettingsPhase = 'closed';
  private destroyed = false;

  constructor(private readonly options: BattleSettingsOptions) {
    this.root.className = 'rr-battle-settings';
    this.root.innerHTML = `
      <style>
        .rr-battle-settings{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:system-ui,sans-serif;color:#f5ead2}
        .rr-battle-settings *{box-sizing:border-box}
        .rr-battle-settings button{font:700 16px system-ui,sans-serif;color:inherit;touch-action:manipulation;cursor:pointer;border:2px solid #bba779;border-radius:9px;background:linear-gradient(#254758,#122735);box-shadow:inset 0 2px #9bb5ba33,0 3px 0 #060e16;min-height:48px;padding:10px 16px;-webkit-tap-highlight-color:transparent}
        .rr-battle-settings button:active{background:#365967;transform:translateY(1px)}
        .rr-battle-settings button:focus-visible{outline:3px solid #ffdc84;outline-offset:3px}
        .rr-battle-settings .rr-gear{position:absolute;width:48px;height:48px;min-height:48px;padding:9px;border-color:#aab6be;pointer-events:auto;border-radius:10px;color:#f8db9a}
        .rr-battle-settings .rr-gear svg{display:block;width:26px;height:26px}
        .rr-battle-settings .rr-overlay{position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center;padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:#020d1cbb}
        .rr-battle-settings [hidden]{display:none!important}
        .rr-battle-settings .rr-panel{position:relative;width:340px;max-width:100%;max-height:100%;overflow:auto;overscroll-behavior:contain;background:linear-gradient(145deg,#1c3a4c,#0d1d2e);border:2px solid #bba779;border-radius:14px;box-shadow:0 16px 48px #0008,inset 0 0 0 5px #9ab3bd14;padding:20px}
        .rr-battle-settings .rr-panel:before,.rr-battle-settings .rr-panel:after{content:'';position:absolute;top:9px;width:5px;height:5px;border-radius:50%;background:#a5b3ba;box-shadow:inset 0 1px 1px #fff8}
        .rr-battle-settings .rr-panel:before{left:9px}.rr-battle-settings .rr-panel:after{right:9px}
        .rr-battle-settings .rr-tag{font:700 10px monospace;letter-spacing:2px;text-align:center;color:#b4c9d2;margin-bottom:5px}
        .rr-battle-settings h2{margin:0 0 18px;text-align:center;font-size:23px;letter-spacing:2px;color:#ffe3a2}
        .rr-battle-settings .rr-actions{display:grid;gap:12px}
        .rr-battle-settings .rr-sound{display:flex;align-items:center;justify-content:space-between;border-color:#899fab}
        .rr-battle-settings .rr-sound span{font-size:13px;letter-spacing:1px;padding:4px 9px;border-radius:5px;background:#527352;color:#e2ffd7}
        .rr-battle-settings .rr-sound[aria-pressed=false] span{background:#46535d;color:#d1dde4}
        .rr-battle-settings .rr-primary{background:linear-gradient(#b99043,#705428);border-color:#e3c17d;color:#fff5d5}
        .rr-battle-settings .rr-primary:active{background:#b99043}
        .rr-battle-settings .rr-secondary{border-color:#8da5b3;color:#d2e5ee}
        .rr-battle-settings .rr-confirm-text{font-size:15px;line-height:1.7;text-align:center;color:#d2e0e9;margin:0 0 18px}
        @media(max-height:360px){.rr-battle-settings .rr-panel{padding:14px 18px}.rr-battle-settings h2{font-size:20px;margin-bottom:12px}.rr-battle-settings .rr-actions{gap:9px}.rr-battle-settings button{padding:8px 14px}}
      </style>
      <button type="button" class="rr-gear" data-action="gear" aria-label="设置" aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.5-2.3.9a8 8 0 0 0-1.7-1L15 3h-4l-.4 2.9a8 8 0 0 0-1.7 1L6.6 6l-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.5 2.3-.9a8 8 0 0 0 1.7 1L11 21h4l.4-2.9a8 8 0 0 0 1.7-1l2.3.9 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>
      </button>
      <div class="rr-overlay" hidden>
        <section class="rr-panel" role="dialog" aria-modal="true" aria-labelledby="rr-settings-title">
          <div class="rr-tag">RICOCHET RIVALS</div><h2 id="rr-settings-title">设置</h2>
          <div class="rr-actions" data-panel="settings">
            <button type="button" class="rr-sound" data-action="sound" aria-pressed="true">声音 <span>开启</span></button>
            <button type="button" class="rr-secondary" data-action="leave">返回主界面</button>
            <button type="button" class="rr-primary" data-action="resume">继续游戏</button>
          </div>
          <div data-panel="confirm" hidden>
            <p class="rr-confirm-text">当前对局将结束，<br>确定返回主界面吗？</p>
            <div class="rr-actions">
              <button type="button" class="rr-primary" data-action="confirm">确定返回</button>
              <button type="button" class="rr-secondary" data-action="cancel">取消</button>
            </div>
          </div>
        </section>
      </div>`;
    this.overlay = this.root.querySelector<HTMLElement>('.rr-overlay')!;
    this.title = this.root.querySelector<HTMLElement>('h2')!;
    this.settings = this.root.querySelector<HTMLElement>('[data-panel=settings]')!;
    this.confirmation = this.root.querySelector<HTMLElement>('[data-panel=confirm]')!;
    this.buttons = Object.fromEntries((['gear', 'sound', 'leave', 'resume', 'cancel', 'confirm'] as const)
      .map((action) => [action, this.root.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!])) as Record<Action, HTMLButtonElement>;
    this.buttons.gear.onclick = () => this.show('settings');
    this.buttons.sound.onclick = () => {
      toggleSound();
      this.renderSound();
      this.options.onSoundChange?.(getUserSettings().soundEnabled);
    };
    this.buttons.leave.onclick = () => this.show('confirm');
    this.buttons.resume.onclick = () => this.show('closed');
    this.buttons.cancel.onclick = () => this.show('settings');
    this.buttons.confirm.onclick = () => {
      this.buttons.confirm.disabled = true;
      this.show('closed');
      this.options.onLeave();
    };
    // Window-level gesture routing must never receive movement or release over this DOM layer.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
    this.buttons.gear.addEventListener('keydown', (event) => event.stopPropagation());
    this.buttons.gear.addEventListener('keyup', (event) => event.stopPropagation());
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
    document.body.appendChild(this.root);
    this.setAnchor({ x: 32, y: 32 });
    this.renderSound();
  }

  get isOpen(): boolean { return this.currentPhase !== 'closed'; }
  get phase(): SettingsPhase { return this.currentPhase; }

  /** Centers and sizes are CSS pixels, matching DOM/pointer coordinates used by browser tests. */
  get debugState() {
    return { phase: this.phase, isOpen: this.isOpen, soundEnabled: getUserSettings().soundEnabled,
      buttons: Object.fromEntries(Object.entries(this.buttons).map(([key, button]) => {
        const rect = button.getBoundingClientRect();
        return [key, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
          width: rect.width, height: rect.height, visible: !this.destroyed && rect.width > 0 && rect.height > 0 }];
      })) };
  }

  setAnchor(anchor: { x: number; y: number }): void {
    this.buttons.gear.style.left = `${anchor.x - 24}px`;
    this.buttons.gear.style.top = `${anchor.y - 24}px`;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKey, true);
    this.root.remove();
    this.currentPhase = 'closed';
  }

  private show(phase: SettingsPhase): void {
    if (this.destroyed || this.currentPhase === phase) return;
    const wasOpen = this.isOpen;
    this.currentPhase = phase;
    this.overlay.hidden = phase === 'closed';
    this.settings.hidden = phase !== 'settings';
    this.confirmation.hidden = phase !== 'confirm';
    this.buttons.gear.hidden = this.isOpen;
    this.title.textContent = phase === 'confirm' ? '退出对局' : '设置';
    this.buttons.gear.setAttribute('aria-expanded', String(this.isOpen));
    this.buttons.gear.tabIndex = this.isOpen ? -1 : 0;
    this.renderSound();
    if (wasOpen !== this.isOpen) this.options.onOpenChange(this.isOpen);
    if (phase === 'closed') {
      if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    } else {
      (phase === 'confirm' ? this.buttons.cancel : this.buttons.sound).focus();
    }
  }

  private renderSound(): void {
    const enabled = getUserSettings().soundEnabled;
    this.buttons.sound.setAttribute('aria-pressed', String(enabled));
    this.buttons.sound.querySelector('span')!.textContent = enabled ? '开启' : '关闭';
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (event.type === 'keydown') this.show(this.phase === 'confirm' ? 'settings' : 'closed');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (event.type !== 'keydown') return;
      const buttons = this.phase === 'confirm' ? [this.buttons.confirm, this.buttons.cancel]
        : [this.buttons.sound, this.buttons.leave, this.buttons.resume];
      const index = buttons.findIndex((button) => button === document.activeElement);
      const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
}
