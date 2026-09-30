import Phaser from 'phaser';
import { MenuArtwork } from '../ui/MenuArtwork';
import { DEBUG_FORCE_RELAY, DEBUG_GAME } from '../config/DebugConfig';
import { PALETTE, toCssColor } from '../config/Palette';
import { InputRouter } from '../input/InputRouter';
import { ViewportService } from '../platform/ViewportService';
import {
  OnlineConnectionController,
  ONLINE_FAILURE_MESSAGES,
} from '../network/OnlineConnectionController';
import { OnlineConnectionState } from '../network/OnlineConnectionState';
import {
  RoomConnectionController,
} from '../network/RoomConnectionController';
import {
  RoomConnectionState,
  type RoomConnectionFailure,
  type RoomConnectionFailureReason,
} from '../network/RoomConnectionState';
import { SignalingClient } from '../network/signaling/SignalingClient';
import { resolveSignalingUrl } from '../network/signaling/signalingUrl';
import {
  ONLINE_SESSION_MANAGER_KEY,
  OnlineSessionManager,
  type OnlineSession,
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
 * 流程选择（SG-5 迁移规格）：正式流 = Room Code + 自动信令；Manual SDP 仅
 * Debug 构建 + ?manual-sdp 查询参数可达（E2E Debug fallback 回归入口）。
 */
const USE_MANUAL_FLOW =
  DEBUG_GAME && new URLSearchParams(window.location.search).has('manual-sdp');


/** SG-7：Room 流失败分类 → 简洁用户文案（技术细节只进 Debug 句柄 / console） */
const ROOM_FAILURE_TEXT: Record<RoomConnectionFailureReason, string> = {
  SIGNALING_FAILED: 'Cannot reach the matchmaking server',
  SERVER_ERROR: 'Matchmaking error — try again',
  INVALID_ROOM_CODE: 'Invalid room code',
  SETUP_FAILED: 'Connection setup failed',
  OFFER_FAILED: 'Connection setup failed',
  ANSWER_FAILED: 'Connection setup failed',
  PEER_LEFT: 'Opponent left',
  ICE_FAILED: 'Connection failed — your network may block WebRTC',
  TURN_UNAVAILABLE: 'Relay server unavailable — cannot reach opponent',
  DATA_CHANNEL_FAILED: 'Connection failed',
  VERIFICATION_TIMEOUT: 'Connection unstable — verification failed',
};

function roomFailureText(failure: RoomConnectionFailure): string {
  if (failure.reason === 'SERVER_ERROR') {
    switch (failure.code) {
      case 'ROOM_NOT_FOUND':
        return 'Room not found — check the code';
      case 'ROOM_FULL':
        return 'Room is full';
      case 'ROOM_EXPIRED':
        return 'Room expired — ask the host for a new code';
      default:
        return ROOM_FAILURE_TEXT.SERVER_ERROR;
    }
  }
  return ROOM_FAILURE_TEXT[failure.reason];
}

/**
 * OnlineConnectionScene（SG-5：Room 流正式 UI + Manual Debug fallback）。
 *
 * 双流（SG-5 迁移规格）：
 * * Room 流（默认）：OnlineConnectionScene → RoomConnectionController →
 *   SignalingClient + WebRTCTransport —— 房间码自动配对，用户零感知 SDP。
 * * Manual 流（DEBUG_GAME && ?manual-sdp）：Phase 13 手动配对 UI 原样保留，
 *   连接码互传；迁移稳定后单独 Cleanup。
 * VERIFIED 之后的进局链（ENTER BATTLE → OnlineGameCoordinator → BattleScene）
 * 两流完全共用。
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
 * - 连接码 / 房间码输入用 DOM textarea（真实文本选择 / 长按粘贴 /
 *   系统键盘 / Ctrl+V；游戏 canvas 的 touch-action:none 不影响 DOM 层）；
 *   动态创建、随场景销毁
 * - 连接流程允许竖屏（Phase 13：仅 Battle 强制横屏，复制 / 粘贴
 *   微信连接码时竖屏体验更佳）
 * - COPY 走 navigator.clipboard.writeText，失败降级为选中文本提示，
 *   不阻塞流程
 */
export class OnlineConnectionScene extends Phaser.Scene {
  static readonly KEY = 'OnlineConnectionScene';

  private viewport!: ViewportService;
  private artwork!: MenuArtwork;
  private inputRouter!: InputRouter;
  /** Manual Debug 流控制器（仅 USE_MANUAL_FLOW 时创建） */
  private controller!: OnlineConnectionController;
  /** Room 流控制器（正式流；USE_MANUAL_FLOW 时为 null） */
  private roomController: RoomConnectionController | null = null;
  /** Room 流 UI 子态：IDLE 下点 JOIN GAME 展开输入（不进控制器状态机） */
  private joinInputVisible = false;
  /** Room 流最近失败文案（RETRY 清除） */
  private roomFailureMessage: string | null = null;
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
  private promptLine!: Phaser.GameObjects.Text;
  private buttons: Partial<Record<OnlineButton, MenuButton>> = {};
  private textarea: HTMLTextAreaElement | null = null;
  /** 当前流程中的连接码（host offer / guest response），COPY 用 */
  private currentCode: string | null = null;
  /** textarea 正只读展示连接码（离开该状态时清空恢复粘贴语义） */
  private textareaHoldsCode = false;
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
    this.textareaHoldsCode = false;
    this.lastRttMs = null;
    this.handedOff = false;
    this.lobbyPhase = 'idle';
    this.lobbyNotice = null;
    this.coordinator = null;
    this.lobbyCancel = null;
    this.pongCancel = null;
    this.roomController = null; // scene.start 复用：room 流字段随 create 重建
    this.joinInputVisible = false;
    this.roomFailureMessage = null;
    // Phase 14：跨 Scene 会话持有者（game.registry；防御缺省本地实例）
    this.sessionManager =
      (this.registry.get(ONLINE_SESSION_MANAGER_KEY) as OnlineSessionManager | undefined) ??
      new OnlineSessionManager();
    this.viewport = new ViewportService(this, { worldCameraZoom: false });
    this.inputRouter = new InputRouter(this);
    this.cameras.main.fadeIn(220, 0, 0, 0);
    this.artwork = new MenuArtwork(this, true);

    if (USE_MANUAL_FLOW) {
      this.setupManualFlow();
    } else {
      this.setupRoomFlow();
    }

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
    this.promptLine = this.add
      .text(0, 0, '', { fontFamily: 'monospace', color: toCssColor(PALETTE.zoneLine) })
      .setOrigin(0.5)
      .setDepth(900);

    this.buttons.create = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-create',
      viewport: this.viewport,
      label: 'CREATE GAME',
      baseHeight: 56,
      onTap: () => void this.onCreateGame(),
    });
    this.buttons.join = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-join',
      viewport: this.viewport,
      label: 'JOIN GAME',
      baseHeight: 56,
      onTap: () => this.onJoinGame(),
    });
    this.buttons.connect = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-connect',
      viewport: this.viewport,
      label: 'CONNECT',
      baseHeight: 56,
      onTap: () => void this.onConnect(),
    });
    this.buttons.copy = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-copy',
      viewport: this.viewport,
      label: 'COPY CODE',
      accent: 0x56698a,
      baseWidth: SMALL_WIDTH,
      baseHeight: 56,
      onTap: () => void this.onCopyCode(),
    });
    this.buttons.createResponse = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-create-response',
      viewport: this.viewport,
      label: 'CREATE RESPONSE',
      baseHeight: 56,
      onTap: () => void this.onCreateResponse(),
    });
    this.buttons.joinConfirm = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-join-confirm',
      viewport: this.viewport,
      label: 'JOIN',
      baseHeight: 56,
      onTap: () => void this.onJoinConfirm(),
    });
    this.buttons.tryAgain = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-try-again',
      viewport: this.viewport,
      label: 'TRY AGAIN',
      baseWidth: SMALL_WIDTH,
      baseHeight: 56,
      onTap: () => {
        if (this.useManualFlow()) {
          this.controller.retry();
          this.failureMessage = null;
        } else {
          this.roomController?.retry();
          this.roomFailureMessage = null;
        }
        this.renderState();
      },
    });
    this.buttons.enterBattle = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-enter-battle',
      viewport: this.viewport,
      label: 'ENTER BATTLE',
      baseHeight: 56,
      onTap: () => this.onEnterBattle(),
    });
    this.buttons.back = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-back',
      viewport: this.viewport,
      // Phase 17 修复轮：手机上 260 宽的 BACK 与底部动作行（CONNECT）重叠
      // —— 改为左上角小 icon（64×64 触控目标达标，E2E 仍经 rect 点击）
      label: '←',
      accent: 0x56698a,
      baseWidth: 64,
      onTap: () => this.leaveToMenu(),
    });
    this.buttons.backToMenu = new MenuButton(this, {
      router: this.inputRouter,
      id: 'online-back-to-menu',
      viewport: this.viewport,
      label: 'BACK TO MENU',
      accent: 0x56698a,
      baseHeight: 56,
      onTap: () => this.leaveToMenu(),
    });

    this.reposition();
    this.viewport.onChange(() => this.reposition());
    this.renderState();
    this.installDebugHandles();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // ---- 流程装配（SG-5 双流） ---------------------------------------------

  /** 当前页激活流（URL 查询参数决定，页面生命周期内恒定） */
  private useManualFlow(): boolean {
    return USE_MANUAL_FLOW;
  }

  /** Manual Debug 流（?manual-sdp）：Phase 13 控制器原样装配 */
  private setupManualFlow(): void {
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
    this.controller.onSession((session) => this.adoptSession(session));
  }

  /** Room 流（正式）：SG-3/4 控制器 —— SignalingClient + Trickle transport */
  private setupRoomFlow(): void {
    const controller = new RoomConnectionController({
      // SG-6：iceServers 来自 Signaling ack（STUN + TURN 临时凭据）；
      // DEBUG_FORCE_RELAY 强制全 relay 验证 TURN 可用性（production 保持 all）
      createTransport: (role, config) =>
        new WebRTCTransport({
          role,
          config: DEBUG_FORCE_RELAY ? { ...config, iceTransportPolicy: 'relay' as const } : config,
        }),
      createSignalingClient: () => new SignalingClient({ url: resolveSignalingUrl() }),
    });
    this.roomController = controller;
    controller.onStateChange((state) => {
      // 房间码就绪 → COPY 源更新（含 RETRY 后重建房）
      if (state === RoomConnectionState.ROOM_WAITING) {
        this.currentCode = controller.currentRoomCode;
      }
      this.renderState();
    });
    controller.onFailure((failure) => {
      this.roomFailureMessage = roomFailureText(failure);
      this.renderState();
    });
    controller.onSession((session) => this.adoptSession(session));
  }

  /** VERIFIED 会话收养（两流共用）：SessionManager 持有 + RTT 轮询 */
  private adoptSession(session: OnlineSession): void {
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
    const verified = this.useManualFlow()
      ? this.controller.currentState === OnlineConnectionState.VERIFIED
      : (this.roomController?.currentState ?? RoomConnectionState.IDLE) === RoomConnectionState.VERIFIED;
    if (session === null || this.coordinator !== null || !verified || this.transitioning) {
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
    if (!this.useManualFlow()) {
      // Room 流：建房（失败经 onFailure 渲染）
      try {
        await this.roomController?.createRoom();
      } catch {
        // failure 已渲染
      }
      return;
    }
    try {
      const { connectionCode } = await this.controller.createHostSession();
      this.currentCode = connectionCode;
      this.renderState(); // currentCode 在状态回调之后才就绪：补渲染"code ready"
    } catch {
      // 失败已由 onFailure 渲染
    }
  }

  private onJoinGame(): void {
    if (!this.useManualFlow()) {
      // Room 流：展开房间码输入（控制器保持 IDLE，输入完成才 joinRoom）
      this.joinInputVisible = true;
      this.renderState();
      return;
    }
    this.controller.startGuestSession();
  }

  /** Room 流：JOIN 确认 —— 输入码送控制器（非法码失败保留输入可重试） */
  private async onJoinConfirm(): Promise<void> {
    const controller = this.roomController;
    if (controller === null) {
      return;
    }
    const code = this.textarea?.value ?? '';
    if (controller.currentState !== RoomConnectionState.IDLE) {
      controller.retry(); // INVALID_ROOM_CODE FAILED 后直接重试
      this.roomFailureMessage = null;
    }
    try {
      await controller.joinRoom(code);
    } catch {
      // 失败已由 onFailure 渲染（INVALID_ROOM_CODE 保留输入）
    }
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
      // currentCode 在 GUEST_WAITING_FOR_HOST 状态回调之后才就绪：必须补渲染，
      // 否则码永不显示（真机曾因此完全无法回传 Response）
      this.renderState();
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
      // navigator.clipboard 需要安全上下文 + 写权限：局域网 HTTP 下 API
      // 缺失（同步抛出，仍在点击手势内），权限被拒时 NotAllowedError。
      // 降级用 legacyCopy 复制【码本身】。禁止 select() 页面上那个输入框
      // —— Host 侧它承载的是待粘贴的 Answer（此刻为空），选中它会把
      // 空内容"成功"复制给用户（真机实测：COPIED! 却贴出空白）。
      const legacyCopied = this.legacyCopy(this.currentCode);
      this.buttons.copy?.setLabel(legacyCopied ? 'COPIED!' : 'COPY FAILED — SELECT & COPY');
    }
    this.time.delayedCall(1_500, () => {
      if (this.buttons.copy) {
        this.buttons.copy.setLabel('COPY CODE');
      }
    });
  }

  /** execCommand 降级复制：临时不可见 textarea 承载目标文本（旧 API 不受
   *  安全上下文限制；必须在用户手势内同步执行；iOS 要求元素在屏幕内，
   *  故 opacity:0 而非移出屏幕，readonly 防唤起键盘）。 */
  private legacyCopy(text: string): boolean {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', 'true');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    el.remove();
    return ok;
  }

  private leaveToMenu(): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    if (this.useManualFlow()) {
      this.controller.back();
      this.controller.dispose();
    } else {
      this.roomController?.back();
      this.roomController?.dispose();
    }
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

  // ---- 渲染（状态驱动，双流分派） -----------------------------------------

  private renderState(): void {
    if (this.useManualFlow()) {
      this.renderManualState();
    } else {
      this.renderRoomState();
    }
  }

  /** Room 流渲染（SG-5 正式 UI：房间码 + 自动连接，零 SDP 露出） */
  private renderRoomState(): void {
    const state = this.roomController?.currentState ?? RoomConnectionState.IDLE;

    const visibleButtons: OnlineButton[] = ['back'];
    let showTextarea = false;
    let status = '';
    let prompt = '';

    switch (state) {
      case RoomConnectionState.IDLE:
        if (this.joinInputVisible) {
          status = 'Enter the 6-character room code.';
          prompt = 'Press JOIN to connect.';
          visibleButtons.push('joinConfirm');
          showTextarea = true;
        } else {
          status = 'CREATE GAME or JOIN GAME';
          visibleButtons.push('create', 'join');
        }
        break;
      case RoomConnectionState.CONNECTING_SIGNALING:
        status = 'Connecting to matchmaking…';
        break;
      case RoomConnectionState.CREATING_ROOM:
        status = 'Creating room…';
        break;
      case RoomConnectionState.ROOM_WAITING:
        status = `ROOM CODE: ${this.roomController?.currentRoomCode ?? ''}`;
        prompt = 'Send the code to your friend — WAITING FOR OPPONENT…';
        visibleButtons.push('copy');
        break;
      case RoomConnectionState.RECONNECTING_SIGNALING:
        status = `ROOM CODE: ${this.roomController?.currentRoomCode ?? ''}`;
        prompt = 'Reconnecting to matchmaking… Your room code is unchanged.';
        visibleButtons.push('copy');
        break;
      case RoomConnectionState.JOINING_ROOM:
        status = 'Joining room…';
        break;
      case RoomConnectionState.NEGOTIATING:
      case RoomConnectionState.CONNECTING:
        status = 'CONNECTING…';
        break;
      case RoomConnectionState.CONNECTED:
        status = 'Connected — verifying connection…';
        break;
      case RoomConnectionState.VERIFIED:
        status = 'CONNECTION VERIFIED — ENTER BATTLE';
        prompt = this.lobbyNotice ?? 'You can enter the game now — press ENTER BATTLE.';
        visibleButtons.length = 0;
        visibleButtons.push('enterBattle', 'backToMenu');
        break;
      case RoomConnectionState.FAILED: {
        const failure = this.roomController?.lastFailure ?? null;
        status = this.roomFailureMessage ?? 'Connection failed';
        // Debug Mode 输出具体 reason（规格 SG-7）：正式构建保持简洁
        if (DEBUG_GAME && failure !== null) {
          status += ` [${failure.reason}${failure.code !== undefined ? `:${failure.code}` : ''}]`;
        }
        visibleButtons.length = 0;
        visibleButtons.push('back');
        // 非法码：保留输入直接改码重试（SG-5 UX：不强迫重开输入框）
        if (failure?.reason === 'INVALID_ROOM_CODE' && this.joinInputVisible) {
          visibleButtons.push('joinConfirm');
          showTextarea = true;
        } else {
          visibleButtons.push('tryAgain');
        }
        break;
      }
      case RoomConnectionState.CLOSED:
        status = 'Connection closed.';
        visibleButtons.length = 0;
        visibleButtons.push('back');
        break;
      default:
        break;
    }

    if (state === RoomConnectionState.VERIFIED) {
      const role = this.sessionManager.current?.role === 'guest' ? 'GUEST' : 'HOST';
      const rtt = this.lastRttMs !== null ? `PING ${this.lastRttMs}ms` : 'PING …';
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
    this.setTextareaVisible(showTextarea);
    if (this.textarea !== null) {
      this.textarea.readOnly = false;
      this.textarea.placeholder = 'Enter room code';
    }
  }

  /** Manual Debug 流渲染（Phase 13 原样） */
  private renderManualState(): void {
    const state = this.controller.currentState;
    const message = this.failureMessage;

    const visibleButtons: OnlineButton[] = ['back'];
    let showTextarea = false;
    let status = '';
    let prompt = '';

    switch (state) {
      case OnlineConnectionState.CHOOSE_ROLE:
        status = 'CREATE GAME or JOIN GAME';
        visibleButtons.push('create', 'join');
        break;
      case OnlineConnectionState.HOST_CREATING_OFFER:
        status = 'Creating connection code…';
        break;
      case OnlineConnectionState.HOST_WAITING_FOR_ANSWER:
        status = 'Press COPY and send the offer code to the other player.';
        prompt = 'When they send back their response code, paste it below and press CONNECT.';
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
        status = 'Paste the offer code from the host below.';
        prompt = 'Then press CREATE RESPONSE and send the response code back to the host.';
        visibleButtons.push('createResponse');
        showTextarea = true;
        break;
      case OnlineConnectionState.GUEST_CREATING_ANSWER:
        status = 'Creating response code…';
        break;
      case OnlineConnectionState.GUEST_WAITING_FOR_HOST:
        status = 'Press COPY and send this response code to the host.';
        prompt = 'The connection opens automatically once the host accepts.';
        visibleButtons.push('copy');
        // textarea 切只读展示 Response 码：HTTP 局域网非 secure context，
        // 移动端无 clipboard API，COPY 必然降级 —— DOM 文本长按选中复制
        // 是手机侧唯一可靠复制路径
        showTextarea = true;
        break;
      case OnlineConnectionState.VERIFIED:
        status = 'CONNECTION VERIFIED — ENTER BATTLE';
        prompt =
          this.lobbyNotice ??
          'You can enter the game now — press ENTER BATTLE.';
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
    this.setTextareaVisible(showTextarea);
    this.syncTextareaForState(state);
  }

  // ---- textarea（DOM 层，真实文本交互） ----------------------------------

  /** textarea 分状态语义：粘贴输入（editable）或只读展示本端连接码。
   *  Guest 的 Response 码必须在 DOM 文本里展示 —— 移动端 HTTP 无
   *  clipboard API，长按选中复制是唯一路径；离开展示态时清空恢复粘贴。 */
  private syncTextareaForState(state: OnlineConnectionState): void {
    const el = this.textarea;
    if (el === null) {
      return;
    }
    const showCode =
      state === OnlineConnectionState.GUEST_WAITING_FOR_HOST && this.currentCode !== null;
    if (showCode) {
      if (!this.textareaHoldsCode) {
        el.value = this.currentCode ?? '';
        this.textareaHoldsCode = true;
      }
      el.readOnly = true;
      el.placeholder = 'Response code — long-press to select & copy';
    } else {
      if (this.textareaHoldsCode) {
        el.value = '';
        this.textareaHoldsCode = false;
      }
      el.readOnly = false;
      el.placeholder = 'Paste connection code here';
    }
  }

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
    if (!this.useManualFlow()) el.rows = 1;
    document.body.appendChild(el);
    this.textarea = el;
    this.positionTextarea();
  }

  private positionTextarea(): void {
    const el = this.textarea;
    if (!el) {
      return;
    }
    const { height, safeArea, uiScale } = this.viewport.current;
    const dpr = window.devicePixelRatio || 1;
    const short = (height - safeArea.top - safeArea.bottom) / uiScale < 380;
    const roomInput = !this.useManualFlow();
    el.style.position = 'fixed';
    el.style.left = roomInput ? '50%' : '10%';
    el.style.transform = roomInput ? 'translateX(-50%)' : '';
    el.style.width = roomInput ? 'min(320px, 80%)' : '80%';
    el.style.height = roomInput ? '52px' : '64px';
    // 与 reposition() 的动作行（CONNECT / CREATE RESPONSE / COPY）同源：
    // 输入框底边停在动作行顶沿上方 12 CSS px —— 保证不与按钮、不与顶部
    // 文案区重叠（旧布局 220px 固定抬高在手机上顶进说明文字区）
    const bottomRowCss = (height - safeArea.bottom - (32 + 28) * uiScale) / dpr;
    const actionTopCss = bottomRowCss - (short ? 0 : 40) - 28;
    const bottomPx = height / dpr - actionTopCss + 12;
    el.style.bottom = `${bottomPx}px`;
    el.style.zIndex = '10';
    el.style.resize = 'none';
    el.style.fontFamily = 'monospace';
    el.style.fontSize = roomInput ? '18px' : '13px';
    el.style.textAlign = roomInput ? 'center' : 'left';
    el.style.textTransform = roomInput ? 'uppercase' : 'none';
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
    this.artwork.layout(this.viewport.current.width, this.viewport.current.height, this.viewport.current.uiScale);
    const { width, height, safeArea, uiScale } = this.viewport.current;
    const availableCssHeight = (height - safeArea.top - safeArea.bottom) / uiScale;
    const compact = availableCssHeight < 650;
    const short = availableCssHeight < 380;
    this.buttons.back?.setPosition(
      safeArea.left + (24 + 32) * uiScale,
      safeArea.top + (24 + 32) * uiScale
    );
    this.title.setFontSize((short ? 24 : compact ? 28 : TITLE_FONT) * uiScale);
    this.title.setPosition(width / 2, safeArea.top + (short ? 76 : compact ? 85 : 121) * uiScale);

    // 横屏短视口把标题、说明和动作区各放独立行，保留 64px 按钮命中区。
    const statusY = safeArea.top + (short ? 115 : compact ? 132 : 160) * uiScale;
    this.statusLine.setFontSize((compact ? 14 : TEXT_FONT) * uiScale);
    this.promptLine.setFontSize((compact ? 13 : TEXT_FONT) * uiScale);
    const textWidth = width - safeArea.left - safeArea.right - 56 * uiScale;
    this.statusLine.setWordWrapWidth(textWidth);
    this.promptLine.setWordWrapWidth(textWidth);
    this.statusLine.setPosition(width / 2, statusY);
    this.promptLine.setPosition(width / 2, statusY + (short ? 25 : compact ? 28 : 34) * uiScale);

    const buttonH = 56 * uiScale;
    const bottomRow = height - safeArea.bottom - 32 * uiScale - buttonH / 2;
    const centerX = width / 2;
    const actionRowY = bottomRow - (short ? 0 : 40) * uiScale;

    const primaryY = compact
      ? height - safeArea.bottom - (short ? 116 : 168) * uiScale
      : height * 0.42;
    this.buttons.create?.setPosition(centerX, primaryY);
    this.buttons.join?.setPosition(centerX, primaryY + buttonH + 16 * uiScale);
    // 动作行：Host 页 CONNECT 与 COPY 并排；Guest 两个动作各占中央
    this.buttons.connect?.setPosition(centerX - 160 * uiScale, actionRowY);
    this.buttons.createResponse?.setPosition(centerX, actionRowY);
    this.buttons.joinConfirm?.setPosition(centerX, actionRowY);
    this.buttons.copy?.setPosition(centerX + 170 * uiScale, actionRowY);
    this.buttons.tryAgain?.setPosition(centerX, compact ? primaryY : height * 0.6);
    const enterY = compact ? primaryY : height * 0.58;
    this.buttons.enterBattle?.setPosition(centerX, enterY);
    this.buttons.backToMenu?.setPosition(centerX, enterY + buttonH + 24 * uiScale);

    this.positionTextarea();
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
        // Room 流下 Manual 控制器未装配 —— 守卫防 debug 句柄崩溃
        return self.controller?.currentState ?? 'MANUAL_FLOW_INACTIVE';
      },
      /** SG-5：Room 流状态 / 房间码 / 失败原因（E2E room 段驱动） */
      get roomState(): string {
        return self.roomController?.currentState ?? 'IDLE';
      },
      get roomCode(): string | null {
        return self.roomController?.currentRoomCode ?? null;
      },
      get roomFailureReason(): string | null {
        return self.roomController?.lastFailure?.reason ?? null;
      },
      /** SG-7：完整失败对象（reason + code + detail —— Debug Mode 具体输出） */
      get roomFailure(): RoomConnectionFailure | null {
        return self.roomController?.lastFailure ?? null;
      },
      /** SG-7：当前状态行文案（E2E 断言用户可见文本用） */
      get statusText(): string {
        return self.statusLine.text;
      },
      get textRects(): Record<'title' | 'status' | 'prompt', { top: number; bottom: number }> {
        const ui = self.viewport.current.uiScale;
        const rect = (text: Phaser.GameObjects.Text) => {
          const bounds = text.getBounds();
          return { top: bounds.top / ui, bottom: bounds.bottom / ui };
        };
        return {
          title: rect(self.title),
          status: rect(self.statusLine),
          prompt: rect(self.promptLine),
        };
      },
      get flow(): string {
        return self.useManualFlow() ? 'manual' : 'room';
      },
      /**
       * SG-6 诊断（异步方法 —— E2E 经 page.evaluate 调用）：连接期走控制器
       * transport；VERIFIED 交接后走 sessionManager 持有的 WebRTCTransport。
       * route = 'DIRECT' | 'RELAY' | null（未连接）。
       */
      async awaitRtcDiagnostics(): Promise<unknown> {
        const viaController = await self.roomController?.getDiagnostics();
        if (viaController !== null && viaController !== undefined) {
          return viaController;
        }
        const transport = self.sessionManager.current?.transport;
        if (transport instanceof WebRTCTransport) {
          return transport.getDiagnostics();
        }
        return null;
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
      if (this.useManualFlow()) {
        this.controller.detach();
      } else {
        this.roomController?.detach();
      }
    } else {
      if (this.useManualFlow()) {
        this.controller.dispose();
      } else {
        this.roomController?.dispose();
      }
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
  | 'joinConfirm'
  | 'tryAgain'
  | 'enterBattle'
  | 'back'
  | 'backToMenu';
