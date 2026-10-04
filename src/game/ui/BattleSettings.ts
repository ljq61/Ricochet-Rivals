import { assetUrl } from '../platform/assetUrl';
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
        .rr-battle-settings button{font:800 17px system-ui,sans-serif;letter-spacing:1px;color:#ebf2ef;text-shadow:0 2px #07131f;touch-action:manipulation;cursor:pointer;border:0;border-radius:0;background:transparent url('${assetUrl('assets/art/button-steel.png')}') center/100% 100% no-repeat;min-height:54px;padding:10px 24px;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 3px 1px #020a11aa)}
        .rr-battle-settings button:active{filter:brightness(1.16) drop-shadow(0 1px 1px #020a11aa);transform:translateY(1px)}
        .rr-battle-settings button:focus-visible{outline:2px solid #ffdc84;outline-offset:2px}
        .rr-battle-settings .rr-gear{position:absolute;width:48px;height:48px;min-height:48px;padding:0;pointer-events:auto;background-image:url('${assetUrl('assets/art/settings-gear.png')}');background-size:contain;filter:drop-shadow(0 2px 2px #05122499)}
        .rr-battle-settings .rr-overlay{position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center;padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:#020d1cb8}
        .rr-battle-settings [hidden]{display:none!important}
        .rr-battle-settings .rr-panel{position:relative;isolation:isolate;width:380px;max-width:100%;max-height:100%;overflow:auto;overscroll-behavior:contain;padding:36px 34px 41px;filter:drop-shadow(0 14px 20px #0009)}
        .rr-battle-settings .rr-panel:before{content:'';position:absolute;inset:0;border:28px solid transparent;border-image:url('${assetUrl('assets/art/portrait-frame.png')}') 255 255 295 255 / 28px 28px 34px 28px round;pointer-events:none;z-index:-1}
        .rr-battle-settings .rr-panel:after{content:'';position:absolute;inset:24px 23px 28px;z-index:-2;background:repeating-linear-gradient(0deg,#7aa2b908 0 1px,transparent 1px 4px),repeating-linear-gradient(90deg,#030b1512 0 1px,transparent 1px 7px),linear-gradient(135deg,#243c4c,#112536 60%,#0c1c2b);box-shadow:inset 0 0 0 2px #081523,inset 0 0 24px #020b17}
        .rr-battle-settings .rr-tag{position:absolute;bottom:12px;left:50%;width:160px;height:22px;display:grid;place-items:center;transform:translateX(-50%);background:url('${assetUrl('assets/art/button-steel.png')}') center/100% 100% no-repeat;font:800 8px monospace;letter-spacing:2px;text-align:center;color:#b7c8cd;text-shadow:0 1px #000}
        .rr-battle-settings h2{width:174px;min-height:39px;display:grid;place-items:center;margin:0 auto 15px;background:url('${assetUrl('assets/art/button-gold.png')}') center/100% 100% no-repeat;text-align:center;font-size:21px;letter-spacing:3px;color:#151c22;text-shadow:0 1px #ffe6a0}
        .rr-battle-settings .rr-actions{display:grid;gap:11px}
        .rr-battle-settings .rr-sound{display:flex;align-items:center;gap:9px;text-align:left}
        .rr-battle-settings .rr-sound b{font:inherit;flex:1}
        .rr-battle-settings .rr-sound-icon{position:relative;display:block;width:23px;height:22px;flex-shrink:0;filter:drop-shadow(0 1px #000)}
        .rr-battle-settings .rr-sound-icon:before{content:'';position:absolute;inset:3px 8px 3px 0;background:#e8c178;clip-path:polygon(0 28%,40% 28%,100% 0,100% 100%,40% 72%,0 72%)}
        .rr-battle-settings .rr-sound-icon:after{content:'';position:absolute;inset:2px 0 2px 8px;border-right:3px solid #e8c178;border-radius:50%}
        .rr-battle-settings .rr-sound span{position:relative;width:81px;height:28px;padding:3px 27px 3px 6px;font:800 12px system-ui,sans-serif;letter-spacing:0;background:repeating-linear-gradient(90deg,#fff1 0 1px,transparent 1px 5px),#183f3c;border:2px solid #6c8478;box-shadow:inset 0 2px 4px #020d14;color:#c2f1ca;text-shadow:0 1px #000;flex-shrink:0}
        .rr-battle-settings .rr-sound span:after{content:'';position:absolute;right:3px;top:2px;width:18px;height:20px;background:repeating-linear-gradient(90deg,transparent 0 4px,#5b411f44 4px 5px),linear-gradient(#f4d492,#a57536);border:1px solid #f6ddb0;box-shadow:1px 1px 0 #071623}
        .rr-battle-settings .rr-sound[aria-pressed=false] span{padding:3px 6px 3px 27px;text-align:right;background-color:#122230;border-color:#546270;color:#9cacb7}
        .rr-battle-settings .rr-sound[aria-pressed=false] span:after{left:3px;right:auto;filter:saturate(.25)}
        .rr-battle-settings .rr-primary{background-image:url('${assetUrl('assets/art/button-gold.png')}');color:#151c22;text-shadow:0 1px #ffe1a0}
        .rr-battle-settings .rr-confirm-text{font-size:15px;line-height:1.7;text-align:center;color:#d2e0e9;text-shadow:0 2px #040e18;margin:0 0 16px;padding:8px 0;border-top:1px solid #78919c44;border-bottom:1px solid #020b16}
        @media(max-height:360px){.rr-battle-settings .rr-panel{width:350px;padding:28px 28px 34px}.rr-battle-settings .rr-panel:before{border-image-width:23px 23px 29px 23px}.rr-battle-settings .rr-panel:after{inset:20px 19px 24px}.rr-battle-settings h2{font-size:19px;min-height:34px;width:158px;margin-bottom:9px}.rr-battle-settings .rr-actions{gap:8px}.rr-battle-settings button{min-height:48px;padding:8px 22px}.rr-battle-settings .rr-gear{padding:0}.rr-battle-settings .rr-tag{bottom:10px;font-size:7px}.rr-battle-settings .rr-confirm-text{margin-bottom:10px;padding:5px 0}}
      </style>
      <button type="button" class="rr-gear" data-action="gear" aria-label="设置" aria-haspopup="dialog" aria-expanded="false"></button>
      <div class="rr-overlay" hidden>
        <section class="rr-panel" role="dialog" aria-modal="true" aria-labelledby="rr-settings-title">
          <div class="rr-tag">RICOCHET RIVALS</div><h2 id="rr-settings-title">设置</h2>
          <div class="rr-actions" data-panel="settings">
            <button type="button" class="rr-sound" data-action="sound" aria-pressed="true"><i class="rr-sound-icon" aria-hidden="true"></i><b>声音</b><span>开启</span></button>
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
