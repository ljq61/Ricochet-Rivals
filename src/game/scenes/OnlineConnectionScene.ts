import Phaser from 'phaser';
import { DEBUG_GAME } from '../config/DebugConfig';
import { PALETTE, toCssColor } from '../config/Palette';
import { InputRouter } from '../input/InputRouter';
import { ViewportService } from '../platform/ViewportService';
import {
  OnlineConnectionController,
  ONLINE_FAILURE_MESSAGES,
} from '../network/OnlineConnectionController';
import { OnlineConnectionState } from '../network/OnlineConnectionState';
import {
  ONLINE_SESSION_MANAGER_KEY,
  OnlineSessionManager,
} from '../network/OnlineSession';
import { OnlineGameCoordinator } from '../network/online/OnlineGameCoordinator';
import type { OnlineBattleBootstrap } from '../network/online/OnlineTypes';
import { WebRTCTransport } from '../network/WebRTCTransport';
import { DEFAULT_WEBRTC_CONFIG } from '../network/WebRTCConfig';
import { createMatchSetup } from '../match/MatchFactory';
import { MenuButton, type ButtonRect } from '../ui/MenuButton';
import { BattleScene } from './BattleScene';
import { MainMenuScene } from './MainMenuScene';

const TITLE_FONT = 34;
const TEXT_FONT = 16;
const SMALL_WIDTH = 260;

/**
 * OnlineConnectionScene（Phase 13 手动配对 + Phase 14 进局）—— 连接流程 UI。
 *
 * OnlineConnectionScene（本类，只渲染状态与转发输入）
 *   → OnlineConnectionController（流程编排 / 状态机 / 超时 / 清理）
 *     → NetworkManager → WebRTCTransport。
 * 本类不 import 任何 RTC API —— 连接码 / SDP 全部经 Controller。
 *
 * Phase 14 进局流：VERIFIED → ENTER BATTLE → OnlineGameCoordinator
 * （PLAYER_READY 双向握手 → Host 汇齐 → GAME_START）→ scene.start
 * (BattleScene, { setup, online: bootstrap })。coordinator 为同一实例
 * 跨 Scene 携带（BattleScene attach 接管），**交接后本场景 SHUTDOWN 不
 * 销毁会话**（handedOff 标志）；SessionManager 由 game.registry 共享
 * （main.ts 组合根注入）。
 *
 * 平台：
 * - 屏幕空间布局（identity 相机，物理像素坐标 + uiScale）
 * - 连接码输入用 DOM textarea（真实文本选择 / 长按粘贴 / 系统键盘 /
 *   Ctrl+V；游戏 canvas 的 touch-action:none 不影响 DOM 层）；
 *   动态创建、随场景销毁
 * - 连接流程允许竖屏（Phase 13：仅 Battle 强制横屏，复制 / 粘贴
 *   微信连接码时竖屏体验更佳）
 * - COPY 走 navigator.clipboard.writeText，失败降级为选中文本提示，
 *   不阻塞流程
 */
export class OnlineConnectionScene extends Phaser.Scene {
  static readonly KEY = 'OnlineConnectionScene';

  private viewport!: ViewportService;
  private inputRouter!: InputRouter;
  private controller!: OnlineConnectionController;
  /** Phase 14：game.registry 注入的跨 Scene 会话持有者（main.ts 组合根） */
  private sessionManager!: OnlineSessionManager;
  /** Phase 14：进局协调器（VERIFIED 后创建，交接后由 BattleScene 接管） */
  private coordinator: OnlineGameCoordinator | null = null;
  private lobbyCancel: (() => void) | null = null;
  /** 已把 coordinator/session 交接给 BattleScene —— SHUTDOWN 不销毁 */
  private handedOff = false;
  /** Lobby 握手阶段（'idle' → ENTER BATTLE 后 'waiting' → GAME_START 后交棒） */
  private lobbyPhase: 'idle' | 'waiting' = 'idle';
  /** Lobby 期断线 / 异常提示（VERIFIED 页展示） */
  private lobbyNotice: string | null = null;

  private title!: Phaser.GameObjects.Text;
  private statusLine!: Phaser.GameObjects.Text;
  private codeLine!: Phaser.GameObjects.Text;
  private promptLine!: Phaser.GameObjects.Text;
  private buttons: Partial<Record<OnlineButton, MenuButton>> = {};
  private textarea: HTMLTextAreaElement | null = null;
  /** 当前流程中的连接码（host offer / guest response），COPY 用 */
  private currentCode: string | null = null;
  private lastRttMs: number | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** RTT 显示的 PONG 订阅取消器（交接 / 关闭时清理） */
  private pongCancel: (() => void) | null = null;
  private failureMessage: string | null = null;
  private transitioning = false;

  constructor() {
    super(OnlineConnectionScene.KEY);
  }

  create(): void {
    this.transitioning = false;
    this.failureMessage = null;
    this.currentCode = null;
    this.lastRttMs = null;
    this.handedOff = false;
    this.lobbyPhase = 'idle';
    this.lobbyNotice = null;
    this.coordinator = null;
    this.lobbyCancel = null;
    this.pongCancel = null;
    // Phase 14：跨 Scene 会话持有者（game.registry；防御缺省本地实例）
    this.sessionManager =
      (this.registry.get(ONLINE_SESSION_MANAGER_KEY) as OnlineSessionManager | undefined) ??
      new OnlineSessionManager();
    this.viewport = new ViewportService(this, { worldCameraZoom: false });
    this.inputRouter = new InputRouter(this);
    this.cameras.main.fadeIn(220, 0, 0, 0);

    this.controller = new OnlineConnectionController({
      matchId: 'online-manual-pairing',
      createTransport: (role) =>
        new WebRTCTransport({ role, config: DEFAULT_WEBRTC_CONFIG }),
    });
    this.controller.onStateChange(() => this.renderState());
    this.controller.onFailure((message) => {
      this.failureMessage = message;
      this.renderState();
    });
    this.controller.onSession((session) => {
      this.sessionManager.store(session);
      // VERIFIED 后持续 ping 展示 RTT（防重复：onSession 幂等失败时双保险）
      if (this.pingTimer === null) {
        this.pingTimer = setInterval(() => {
          try {
            session.networkManager.ping();
          } catch {
            // 会话已断（回菜单清理后）—— 定时器随 shutdown 清除
          }
        }, 2_000);
      }
      this.pongCancel = session.networkManager.onPong((envelope) => {
        this.lastRttMs = Math.max(0, Date.now() - envelope.payload.sentAt);
        this.renderState();
      });
    });

    this.title = this.add
      .text(0, 0, 'ONLINE MULTIPLAYER', {
        fontFamily: 'monospace',
        color: toCssColor(PALETTE.head),
      })
      .setOrigin(0.5)
      .setDepth(900);
    this.statusLine = this.add
      .text(0, 0, '', { fontFamily: 'monospace', color: '#e8eef7' })
      .setOrigin(0.5)
      .setDepth(900);
    this.codeLine = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        color: '#8fa3c7',
        wordWrap: { width: 900 },
      })
      .setOrigin(0.5)
      .setDepth(900);
    this.promptLine = this.add
      .text(0, 0, '', { fontFamily: 'monospace', color: toCssColor(PALETTE.zoneLine) })
      .setOrigin(0.5)
      .setDepth(900);

    this.buttons.create = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-create',
      viewport: this.viewport,
      label: 'CREATE GAME',
      onTap: () => void this.onCreateGame(),
    });
    this.buttons.join = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-join',
      viewport: this.viewport,
      label: 'JOIN GAME',
      onTap: () => this.onJoinGame(),
    });
    this.buttons.connect = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-connect',
      viewport: this.viewport,
      label: 'CONNECT',
      onTap: () => void this.onConnect(),
    });
    this.buttons.copy = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-copy',
      viewport: this.viewport,
      label: 'COPY CODE',
      accent: 0x56698a,
      baseWidth: SMALL_WIDTH,
      onTap: () => void this.onCopyCode(),
    });
    this.buttons.createResponse = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-create-response',
      viewport: this.viewport,
      label: 'CREATE RESPONSE',
      onTap: () => void this.onCreateResponse(),
    });
    this.buttons.tryAgain = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-try-again',
      viewport: this.viewport,
      label: 'TRY AGAIN',
      baseWidth: SMALL_WIDTH,
      onTap: () => {
        this.controller.retry();
        this.failureMessage = null;
      },
    });
    this.buttons.enterBattle = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-enter-battle',
      viewport: this.viewport,
      label: 'ENTER BATTLE',
      onTap: () => this.onEnterBattle(),
    });
    this.buttons.back = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-back',
      viewport: this.viewport,
      label: 'BACK',
      accent: 0x56698a,
      baseWidth: SMALL_WIDTH,
      onTap: () => this.leaveToMenu(),
    });
    this.buttons.backToMenu = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-back-to-menu',
      viewport: this.viewport,
      label: 'BACK TO MENU',
      accent: 0x56698a,
      onTap: () => this.leaveToMenu(),
    });

    this.reposition();
    this.viewport.onChange(() => this.reposition());
    this.renderState();
    this.installDebugHandles();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // ---- 用户动作 ---------------------------------------------------------

  /**
   * Phase 14 进局：VERIFIED 后创建协调器并发送 PLAYER_READY。
   * Host 汇齐双方 Ready → GAME_START（本端本地触发）；Guest 收到
   * GAME_START 校验通过触发 —— 双方经 onStart 转入 BattleScene。
   * createMatchIdentity 的随机性属对局 setup（非 Gameplay RNG，
   * CODELY.md §16 管的是局内随机）。
   */
  private onEnterBattle(): void {
    const session = this.sessionManager.current;
    if (
      session === null ||
      this.coordinator !== null ||
      this.controller.currentState !== OnlineConnectionState.VERIFIED ||
      this.transitioning
    ) {
      return;
    }
    this.coordinator = new OnlineGameCoordinator({
      session,
      createMatchIdentity: () => ({
        matchId: `match-${Date.now().toString(36)}-${Math.floor(
          Math.random() * 1e9,
        ).toString(36)}`,
        seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0,
      }),
    });
    this.lobbyCancel = this.coordinator.enterLobby({
      onStart: (bootstrap) => this.startOnlineBattle(bootstrap),
      onDisconnected: () => {
        // Lobby 期断线：清协调器并提示（连接已失效，只能返回菜单）
        this.coordinator?.dispose();
        this.coordinator = null;
        this.lobbyCancel = null;
        this.lobbyPhase = 'idle';
        this.lobbyNotice = 'CONNECTION LOST — BACK TO MENU';
        this.renderState();
      },
    });
    this.coordinator.sendPlayerReady();
    this.lobbyPhase = 'waiting';
    this.lobbyNotice = null;
    this.renderState();
  }

  /** GAME_START 就绪 → 转场 BattleScene（交接 coordinator + 会话） */
  private startOnlineBattle(bootstrap: OnlineBattleBootstrap): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    this.handedOff = true;
    // Lobby handlers 交棒：取消本场景回调（BattleScene attach 后由协调器接管）
    this.lobbyCancel?.();
    this.lobbyCancel = null;
    const data = {
      setup: createMatchSetup('online', bootstrap.role),
      online: bootstrap,
    };
    let started = false;
    const startBattle = (): void => {
      if (started) {
        return;
      }
      started = true;
      this.scene.start(BattleScene.KEY, data);
    };
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      startBattle
    );
    // 兜底：页面后台化（visibilityState=hidden）时 rAF 冻结会卡住 fade
    // 完成事件（P2P E2E 双页实测）—— 300ms 定时器先到先得
    this.time.delayedCall(300, startBattle);
  }

  private async onCreateGame(): Promise<void> {
    try {
      const { connectionCode } = await this.controller.createHostSession();
      this.currentCode = connectionCode;
    } catch {
      // 失败已由 onFailure 渲染
    }
  }

  private onJoinGame(): void {
    this.controller.startGuestSession();
  }

  private async onConnect(): Promise<void> {
    const code = this.textarea?.value ?? '';
    await this.controller.submitAnswerCode(code);
  }

  private async onCreateResponse(): Promise<void> {
    const code = this.textarea?.value ?? '';
    try {
      const { responseCode } = await this.controller.submitOfferCode(code);
      this.currentCode = responseCode;
    } catch {
      // 失败已由 onFailure 渲染
    }
  }

  private async onCopyCode(): Promise<void> {
    if (!this.currentCode) {
      return;
    }
    this.buttons.copy?.setLabel('COPIED!');
    try {
      await navigator.clipboard.writeText(this.currentCode);
    } catch {
      // 剪贴板权限失败：降级选中文本（textarea 内手动复制）
      this.textarea?.select();
      this.buttons.copy?.setLabel('COPY FAILED — SELECT & COPY');
    }
    this.time.delayedCall(1_500, () => {
      if (this.buttons.copy) {
        this.buttons.copy.setLabel('COPY CODE');
      }
    });
  }

  private leaveToMenu(): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    this.controller.back();
    this.controller.dispose();
    this.coordinator?.dispose();
    this.coordinator = null;
    this.lobbyCancel = null;
    this.sessionManager.disposeSession();
    let started = false;
    const startMenu = (): void => {
      if (started) {
        return;
      }
      started = true;
      this.scene.start(MainMenuScene.KEY);
    };
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      startMenu
    );
    // 兜底：页面后台化（visibilityState=hidden）时 rAF 冻结会卡住 fade
    // 完成事件（P2P E2E 双页实测）—— 300ms 定时器先到先得；
    // started 标志保证 scene.start 幂等，前台路径视觉不受影响（fade 220ms）
    this.time.delayedCall(300, startMenu);
  }

  // ---- 渲染（状态驱动） ---------------------------------------------------

  private renderState(): void {
    const state = this.controller.currentState;
    const message = this.failureMessage;

    const visibleButtons: OnlineButton[] = ['back'];
    let showTextarea = false;
    let status = '';
    let prompt = '';
    let codePreview = '';

    switch (state) {
      case OnlineConnectionState.CHOOSE_ROLE:
        status = 'CREATE GAME or JOIN GAME';
        visibleButtons.push('create', 'join');
        break;
      case OnlineConnectionState.HOST_CREATING_OFFER:
        status = 'Creating connection code…';
        break;
      case OnlineConnectionState.HOST_WAITING_FOR_ANSWER:
        status = 'STEP 1 — Send this connection code to your friend.';
        prompt = 'STEP 2 — Ask your friend to send back their response code, then paste it below and CONNECT.';
        codePreview = this.currentCode ? 'Connection code ready' : '';
        visibleButtons.push('copy', 'connect');
        showTextarea = true;
        break;
      case OnlineConnectionState.HOST_APPLYING_ANSWER:
      case OnlineConnectionState.CONNECTING:
        status = 'Connecting…';
        break;
      case OnlineConnectionState.CONNECTED:
        status = 'Connected — verifying connection…';
        break;
      case OnlineConnectionState.GUEST_WAITING_FOR_OFFER:
        status = 'Paste the host connection code below, then CREATE RESPONSE.';
        visibleButtons.push('createResponse');
        showTextarea = true;
        break;
      case OnlineConnectionState.GUEST_CREATING_ANSWER:
        status = 'Creating response code…';
        break;
      case OnlineConnectionState.GUEST_WAITING_FOR_HOST:
        status = 'Send this response code back to the host.';
        prompt = 'WAITING FOR HOST… (connection opens automatically once the host accepts)';
        codePreview = this.currentCode ? 'Response code ready' : '';
        visibleButtons.push('copy');
        break;
      case OnlineConnectionState.VERIFIED:
        status = 'CONNECTION VERIFIED — ENTER BATTLE';
        prompt =
          this.lobbyNotice ??
          'Opponent connected. The match starts when both players press ENTER BATTLE.';
        visibleButtons.length = 0;
        visibleButtons.push('enterBattle', 'backToMenu');
        break;
      case OnlineConnectionState.FAILED:
        status = message ?? ONLINE_FAILURE_MESSAGES.setupFailed;
        visibleButtons.length = 0;
        visibleButtons.push('tryAgain', 'back');
        break;
      case OnlineConnectionState.CLOSED:
        status = 'Connection closed.';
        visibleButtons.length = 0;
        visibleButtons.push('back');
        break;
      default:
        break;
    }

    if (state === OnlineConnectionState.VERIFIED) {
      const role = this.sessionManager.current?.role === 'guest' ? 'GUEST' : 'HOST';
      const rtt = this.lastRttMs !== null ? `PING ${this.lastRttMs}ms` : 'PING …';
      // Phase 14：ENTER BATTLE 后进入等待 Host GAME_START 阶段
      status =
        this.lobbyPhase === 'waiting'
          ? `WAITING FOR OPPONENT… — ${role} — ${rtt}`
          : `CONNECTED — ${role} — ${rtt}`;
    }

    for (const [key, button] of Object.entries(this.buttons)) {
      const typedKey = key as OnlineButton;
      button?.setVisible(visibleButtons.includes(typedKey));
    }

    this.statusLine.setText(status);
    this.promptLine.setText(prompt);
    this.codeLine.setText(codePreview);
    this.setTextareaVisible(showTextarea);
    this.relayoutForState(state);
  }

  // ---- textarea（DOM 层，真实文本交互） ----------------------------------

  private setTextareaVisible(visible: boolean): void {
    if (visible && this.textarea === null) {
      this.createTextarea();
    }
    if (this.textarea) {
      this.textarea.style.display = visible ? 'block' : 'none';
    }
  }

  private createTextarea(): void {
    const el = document.createElement('textarea');
    el.id = 'online-code-input';
    el.placeholder = 'Paste connection code here';
    el.spellcheck = false;
    el.autocapitalize = 'off';
    el.autocomplete = 'off';
    document.body.appendChild(el);
    this.textarea = el;
    this.positionTextarea();
  }

  private positionTextarea(): void {
    const el = this.textarea;
    if (!el) {
      return;
    }
    const { safeArea } = this.viewport.current;
    el.style.position = 'fixed';
    el.style.left = '10%';
    el.style.width = '80%';
    el.style.height = '72px';
    // 底部抬高：避开底部按钮行与 Home Indicator（Safe Area）
    const bottomPx = safeArea.bottom / (window.devicePixelRatio || 1) + 220;
    el.style.bottom = `${bottomPx}px`;
    el.style.zIndex = '10';
    el.style.resize = 'none';
    el.style.fontFamily = 'monospace';
    el.style.fontSize = '13px';
    el.style.background = 'rgba(13, 20, 32, 0.9)';
    el.style.color = '#e8eef7';
    el.style.border = '1px solid #56698a';
    el.style.borderRadius = '8px';
    el.style.padding = '8px';
    el.style.boxSizing = 'border-box';
    el.style.touchAction = 'auto';
    el.style.userSelect = 'text';
    el.style.webkitUserSelect = 'text';
  }

  // ---- 布局 ---------------------------------------------------------------

  private reposition(): void {
    const { width, height, safeArea, uiScale } = this.viewport.current;
    this.title.setFontSize(TITLE_FONT * uiScale);
    this.title.setPosition(width / 2, safeArea.top + 60 * uiScale + TITLE_FONT * 0.6 * uiScale);

    this.statusLine.setFontSize(TEXT_FONT * uiScale);
    this.promptLine.setFontSize(TEXT_FONT * uiScale);
    this.codeLine.setFontSize(TEXT_FONT * uiScale);

    const buttonH = 64 * uiScale;
    const bottomRow = height - safeArea.bottom - 32 * uiScale - buttonH / 2;
    const centerX = width / 2;

    this.buttons.create?.setPosition(centerX, height * 0.42);
    this.buttons.join?.setPosition(centerX, height * 0.42 + (buttonH + 20 * uiScale));
    this.buttons.connect?.setPosition(centerX, bottomRow - 40 * uiScale);
    this.buttons.createResponse?.setPosition(centerX, bottomRow - 40 * uiScale);
    this.buttons.tryAgain?.setPosition(centerX, height * 0.6);
    this.buttons.enterBattle?.setPosition(centerX, height * 0.58);
    this.buttons.back?.setPosition(
      centerX - 200 * uiScale,
      bottomRow
    );
    this.buttons.backToMenu?.setPosition(centerX, height * 0.72);
    this.buttons.copy?.setPosition(centerX, height * 0.56);

    this.positionTextarea();
    this.relayoutForState(this.controller.currentState);
  }

  /** 状态相关文本行布局（textarea 下方 / 按钮上方） */
  private relayoutForState(state: OnlineConnectionState): void {
    const { width, height, uiScale } = this.viewport.current;
    const centerX = width / 2;
    const needsTextarea =
      state === OnlineConnectionState.HOST_WAITING_FOR_ANSWER ||
      state === OnlineConnectionState.GUEST_WAITING_FOR_OFFER;

    const textTop = needsTextarea
      ? height - 380 * uiScale + 100 * uiScale
      : height * 0.3;
    this.statusLine.setPosition(centerX, textTop);
    this.codeLine.setPosition(centerX, textTop + TEXT_FONT * 1.6 * uiScale);
    this.promptLine.setPosition(centerX, textTop + TEXT_FONT * 3.2 * uiScale);
  }

  // ---- E2E / 调试 ---------------------------------------------------------

  private installDebugHandles(): void {
    if (!DEBUG_GAME) {
      return;
    }
    const self = this;
    (window as unknown as Record<string, unknown>).__RR_DEBUG__ = {
      get scene(): string {
        return 'OnlineConnectionScene';
      },
      get state(): string {
        return self.controller.currentState;
      },
      get connectionCode(): string | null {
        return self.currentCode;
      },
      get failureMessage(): string | null {
        return self.failureMessage;
      },
      get lastRttMs(): number | null {
        return self.lastRttMs;
      },
      /** 诊断:onSession 是否已把会话交给 SessionManager */
      get sessionStored(): boolean {
        return self.sessionManager.current !== null;
      },
      /** Phase 14：Lobby 握手阶段（E2E 断言 ENTER BATTLE 流程用） */
      get lobbyPhase(): string {
        return self.lobbyPhase;
      },
      get handedOff(): boolean {
        return self.handedOff;
      },
      /** 诊断:Phaser 全场景生命周期状态（切换问题定位用） */
      get phaserSceneStates(): Array<{ key: string; status: string }> {
        const manager = self.scene.manager;
        return manager.getScenes(false).map((scene: { scene: { key: string } }) => {
          const key = scene.scene.key;
          const active = manager.isActive(key);
          const sleeping = manager.isSleeping(key);
          const visible = manager.isVisible?.(key);
          return {
            key,
            status: active ? 'active' : sleeping ? 'sleeping' : visible ? 'visible' : 'pending',
          };
        });
      },
      get inputText(): string {
        return self.textarea?.value ?? '';
      },
      setInputText(text: string): void {
        if (self.textarea) {
          self.textarea.value = text;
        }
      },
      get buttons(): Record<string, ButtonRect> {
        const ui = self.viewport.current.uiScale;
        const rects: Record<string, ButtonRect> = {};
        for (const [key, button] of Object.entries(self.buttons)) {
          if (button) {
            const r = button.rect();
            rects[key] = {
              x: r.x / ui,
              y: r.y / ui,
              width: r.width / ui,
              height: r.height / ui,
            };
          }
        }
        return rects;
      },
    };
  }

  private onShutdown(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pongCancel?.();
    this.pongCancel = null;
    // Phase 14：交接后 coordinator / session 归 BattleScene 生命周期
    //（SHUTDOWN 禁销毁 —— scene.start 转场必经此处）。controller 交接后
    // 必须 detach：dispose 的 destroySession 会就地杀死已交接的通道。
    // 未交接（回菜单 / 失败退出）则彻底清理。
    if (this.handedOff) {
      this.controller.detach();
    } else {
      this.controller.dispose();
      this.coordinator?.dispose();
      this.coordinator = null;
      this.sessionManager.disposeSession();
      this.lobbyCancel = null;
    }
    this.textarea?.remove();
    this.textarea = null;
    this.viewport.destroy();
    this.inputRouter.destroy();
  }
}

type OnlineButton =
  | 'create'
  | 'join'
  | 'connect'
  | 'copy'
  | 'createResponse'
  | 'tryAgain'
  | 'enterBattle'
  | 'back'
  | 'backToMenu';
