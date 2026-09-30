import { NetworkManager, type PingPongPayload } from './NetworkManager';
import { OnlineSession } from './OnlineSession';
import type { PeerRole } from './PeerRole';
import {
  RoomConnectionState,
  type RoomConnectionFailure,
  type RoomConnectionFailureReason,
} from './RoomConnectionState';
import { decodeSignaling } from './signaling/SignalingCodec';
import { SignalingClient, SignalingError, type SignalingFailure } from './signaling/SignalingClient';
import type { SignalingIceServer, SignalingInboundMessage } from './signaling/SignalingMessage';
import { WebRTCTransport, type WebRTCDiagnostics } from './WebRTCTransport';
import type { WebRTCConfig } from './WebRTCConfig';
import type { MatchId, PlayerId } from '../state/ids';

/**
 * RoomConnectionController（SG-3）—— 房间码自动配对流程编排器。
 *
 * 架构位置（迁移规格推荐边界）：
 *
 *   OnlineConnectionScene（UI，SG-5 接入）
 *     → RoomConnectionController（本类：流程编排 / 状态机 / 超时 / 清理）
 *       → SignalingClient（房间信令：Room Code / SDP / ICE 转发）
 *       → WebRTCTransport（DataChannel —— Gameplay 通道）
 *
 * 复用 Phase 12–14 既有架构（禁止复制 ConnectionCode 机制）：
 * * NetworkManager PING/PONG 验证与 OnlineSession 交接链原样复用 —— Host=P1 /
 *   Guest=P2、VERIFIED → OnlineSession → SessionManager → BattleScene 与
 *   Manual 流完全一致（Phase 14 组合根不变）。
 * * 验证语义沿用 Manual 流实战教训（OnlineConnectionController 注释）：
 *   PONG 窗口放宽（手机后台化回前台才回 PONG）；connect 成功即清预算
 *   timer（不清会让已连会话被预算误杀）；VERIFIED 幂等去重。
 *
 * 与 Manual 流的关键差异：SDP 经 Signaling 自动交换（用户零感知连接码）；
 * SignalingClient 生命周期延伸到对局（session.signaling —— SG-8 ICE restart
 * 的重信令通道：房间保持存活，玩家无需重输房间码），由 SessionManager
 * dispose 链统一收口。
 *
 * 红线：本类不 import NetworkEnvelope / GameCommand —— Signaling 是连接
 * 协议，Gameplay 只走 DataChannel。
 */

export interface RoomConnectionControllerOptions {
  /** 每次尝试新建 transport（retry 重建；iceServers 来自 Signaling ROOM ack） */
  readonly createTransport: (role: PeerRole, config: WebRTCConfig) => WebRTCTransport;
  /** Signaling 客户端工厂（Scene 注入部署 URL；测试注入 fake WS 工厂） */
  readonly createSignalingClient: () => SignalingClient;
  /** 配对 → DataChannel open 总预算（默认 45s：自动流无人肉传码延迟） */
  readonly negotiationTimeoutMs?: number;
  /** CONNECTED 后 PONG 窗口（默认 120s：手机后台化税制，同 Manual 流） */
  readonly verificationTimeoutMs?: number;
}

const DEFAULT_NEGOTIATION_TIMEOUT_MS = 45_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 120_000;

interface FlowDeferred {
  readonly promise: Promise<void>;
  settled: boolean;
  settleResolve: () => void;
  settleReject: (error: Error) => void;
}

type StateHandler = (state: RoomConnectionState) => void;
type FailureHandler = (failure: RoomConnectionFailure) => void;
type SessionHandler = (session: OnlineSession) => void;

export class RoomConnectionController {
  private readonly options: RoomConnectionControllerOptions;
  private readonly negotiationTimeoutMs: number;
  private readonly verificationTimeoutMs: number;

  private controllerState: RoomConnectionState = RoomConnectionState.IDLE;
  private failure: RoomConnectionFailure | null = null;
  private role: PeerRole | null = null;
  private roomCode: string | null = null;
  private peerToken: string | null = null;
  private iceServers: SignalingIceServer[] = [];
  private negotiationDeadline = 0;

  private signaling: SignalingClient | null = null;
  private transport: WebRTCTransport | null = null;
  private manager: NetworkManager | null = null;
  private readonly cancels: Array<() => void> = [];

  private negotiationTimer: ReturnType<typeof setTimeout> | null = null;
  private verificationTimer: ReturnType<typeof setTimeout> | null = null;
  private flowDeferred: FlowDeferred | null = null;
  private verified = false;
  private disposed = false;
  /** Phase 14 交接态：session 已移交（SessionManager 持有），dispose 降级为 no-op */
  private detached = false;

  private readonly stateHandlers = new Set<StateHandler>();
  private readonly failureHandlers = new Set<FailureHandler>();
  private readonly sessionHandlers = new Set<SessionHandler>();

  constructor(options: RoomConnectionControllerOptions) {
    this.options = options;
    this.negotiationTimeoutMs = options.negotiationTimeoutMs ?? DEFAULT_NEGOTIATION_TIMEOUT_MS;
    this.verificationTimeoutMs = options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  }

  get currentState(): RoomConnectionState {
    return this.controllerState;
  }

  /** 房间码（Host：ROOM_CREATED 后可读；UI COPY 用） */
  get currentRoomCode(): string | null {
    return this.roomCode;
  }

  /** 本端重连身份锚点（SG-2 ROOM ack；SG-8 掉线重入用；Debug 诊断面） */
  get currentPeerToken(): string | null {
    return this.peerToken;
  }

  /** 最近失败详情（FAILED 后保留至 retry / back） */
  get lastFailure(): RoomConnectionFailure | null {
    return this.failure;
  }

  /** SG-6 诊断：委托 transport（连接期）；VERIFIED 交接后 transport 归 Session → null */
  async getDiagnostics(): Promise<WebRTCDiagnostics | null> {
    return this.transport?.getDiagnostics() ?? null;
  }

  // ---- 订阅（handler 异常不逃逸；与 Manual 控制器同风格） -------------------

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  onFailure(handler: FailureHandler): () => void {
    this.failureHandlers.add(handler);
    return () => {
      this.failureHandlers.delete(handler);
    };
  }

  /** VERIFIED 时回调一次（OnlineSession 交 SessionManager 前的观察口） */
  onSession(handler: SessionHandler): () => void {
    this.sessionHandlers.add(handler);
    return () => {
      this.sessionHandlers.delete(handler);
    };
  }

  // ---- 流程入口 -------------------------------------------------------------

  /** Host：建房。resolve 于 ROOM_WAITING（房间码就绪）；失败 reject。 */
  async createRoom(): Promise<void> {
    return this.beginFlow('host', async (signaling) => {
      this.setState(RoomConnectionState.CREATING_ROOM);
      signaling.createRoom();
      // 后续：ROOM_CREATED → ROOM_WAITING（applySignalingMessage 推进）
    });
  }

  /** Guest：加入。resolve 于 NEGOTIATING（入房成功，自动协商继续）；失败 reject。 */
  async joinRoom(roomCode: string): Promise<void> {
    return this.beginFlow('guest', async (signaling) => {
      this.setState(RoomConnectionState.JOINING_ROOM);
      try {
        signaling.joinRoom(roomCode);
      } catch (error) {
        if (error instanceof SignalingError && error.reason === 'INVALID_ROOM_CODE') {
          this.fail({ reason: 'INVALID_ROOM_CODE', detail: `room code rejected: '${roomCode}'` });
        } else {
          throw error;
        }
      }
    });
  }

  // ---- 生命周期（与 OnlineConnectionController 同语义） -------------------

  /** Retry：彻底销毁当前尝试回 IDLE（不复活 failed PeerConnection / WS） */
  retry(): void {
    this.destroyAttempt();
    this.failure = null;
    this.setState(RoomConnectionState.IDLE);
  }

  /** Back / 退出：彻底清理并 CLOSED（后台连接不得残留） */
  back(): void {
    this.destroyAttempt();
    this.setState(RoomConnectionState.CLOSED);
  }

  /** 生命周期终了（Scene shutdown）；幂等 */
  dispose(): void {
    if (this.disposed || this.detached) {
      return;
    }
    this.disposed = true;
    this.destroyAttempt();
    this.stateHandlers.clear();
    this.failureHandlers.clear();
    this.sessionHandlers.clear();
    this.controllerState = RoomConnectionState.CLOSED;
  }

  /**
   * Phase 14 交接：session（含 transport / manager / signaling）已移交给
   * SessionManager。只清本控制器的 handler 与计时器，**禁止销毁已交接资源**
   * （对局与信令生命周期归 SessionManager dispose 链）。
   */
  detach(): void {
    if (this.detached || this.disposed) {
      return;
    }
    this.detached = true;
    this.clearTimers();
    this.stateHandlers.clear();
    this.failureHandlers.clear();
    this.sessionHandlers.clear();
    this.rejectFlowDeferred('session handed off');
    this.flowDeferred = null;
  }

  // ---- 内部：流程驱动 -------------------------------------------------------

  /** 通用入口：建 Signaling → 拨号 → 角色动作；deferred 在 ROOM ack 时 settle */
  private async beginFlow(
    role: PeerRole,
    roleAction: (signaling: SignalingClient) => Promise<void>,
  ): Promise<void> {
    if (this.controllerState !== RoomConnectionState.IDLE) {
      throw new Error(`[RoomConnection] flow requires IDLE (current: ${this.controllerState})`);
    }
    this.role = role;
    const deferred = this.makeFlowDeferred();
    this.flowDeferred = deferred;
    const signaling = this.createAndWireSignaling();
    this.setState(RoomConnectionState.CONNECTING_SIGNALING);
    try {
      await signaling.connect();
      await roleAction(signaling);
    } catch (error) {
      // deferred 已被 applySignalingFailure / fail 收口时幂等；此处兜底其余异常
      this.fail({
        reason: 'SIGNALING_FAILED',
        detail: `signaling flow error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return deferred.promise;
  }

  /** SignalingClient 创建 + 订阅（消息分发 / 失败收口） */
  private createAndWireSignaling(): SignalingClient {
    const signaling = this.options.createSignalingClient();
    this.signaling = signaling;
    this.cancels.push(
      signaling.onMessage((message) => this.applySignalingMessage(message)),
      signaling.onFailure((failure) => this.applySignalingFailure(failure)),
    );
    return signaling;
  }

  /** 入站信令分发（状态迁移 + 协商动作） */
  private applySignalingMessage(message: SignalingInboundMessage): void {
    switch (message.type) {
      case 'ROOM_CREATED':
        if (this.role !== 'host' || this.controllerState !== RoomConnectionState.CREATING_ROOM) {
          console.warn(
            `[RoomConnection] ROOM_CREATED ignored (role: ${this.role}, state: ${this.controllerState})`,
          );
          return;
        }
        this.acceptRoomAck(message.roomCode, message.peerToken, message.iceServers);
        this.setState(RoomConnectionState.ROOM_WAITING);
        this.resolveFlowDeferred();
        return;
      case 'ROOM_JOINED':
        if (this.role !== 'guest' || this.controllerState !== RoomConnectionState.JOINING_ROOM) {
          console.warn(
            `[RoomConnection] ROOM_JOINED ignored (role: ${this.role}, state: ${this.controllerState})`,
          );
          return;
        }
        this.acceptRoomAck(message.roomCode, message.peerToken, message.iceServers);
        this.beginNegotiationWindow(); // Host 已在房内 → 直接进入协商（等 OFFER）
        this.setState(RoomConnectionState.NEGOTIATING);
        this.resolveFlowDeferred();
        return;
      case 'PEER_JOINED':
        if (this.role !== 'host' || this.controllerState !== RoomConnectionState.ROOM_WAITING) {
          console.warn(`[RoomConnection] PEER_JOINED ignored (state: ${this.controllerState})`);
          return;
        }
        this.beginNegotiationWindow();
        this.setState(RoomConnectionState.NEGOTIATING);
        void this.hostSendOffer();
        return;
      case 'OFFER':
        if (this.role !== 'guest' || this.controllerState !== RoomConnectionState.NEGOTIATING) {
          console.warn(`[RoomConnection] OFFER ignored (state: ${this.controllerState})`);
          return;
        }
        void this.guestHandleOffer(message.sdp);
        return;
      case 'ANSWER':
        if (this.role !== 'host' || this.controllerState !== RoomConnectionState.NEGOTIATING) {
          console.warn(`[RoomConnection] ANSWER ignored (state: ${this.controllerState})`);
          return;
        }
        void this.hostHandleAnswer(message.sdp);
        return;
      case 'ICE_CANDIDATE':
        // Trickle ICE（SG-4）：remoteDescription 未 apply 时 transport 内部排队
        this.transport?.addIceCandidate(message.candidate);
        return;
      case 'ICE_END':
        // 对端 gathering 完结（informational）—— ICE 不依赖显式 end，无需动作
        console.debug('[RoomConnection] remote ICE_END received');
        return;
      case 'PEER_LEFT':
        // 协商期对端离开 = 连接失败；VERIFIED 后归 Phase 16 断线链（本层不越权）
        if (!this.verified && this.controllerState !== RoomConnectionState.CLOSED) {
          this.fail({ reason: 'PEER_LEFT', detail: 'opponent left during negotiation' });
        }
        return;
      default:
        return;
    }
  }

  /** SignalingFailure → RoomConnectionFailure 分类 */
  private applySignalingFailure(failure: SignalingFailure): void {
    if (failure.reason === 'SERVER_ERROR') {
      this.fail({ reason: 'SERVER_ERROR', code: failure.code, detail: failure.detail });
      return;
    }
    this.fail({
      reason: 'SIGNALING_FAILED',
      detail: `${failure.reason}${failure.detail !== undefined ? `: ${failure.detail}` : ''}`,
    });
  }

  private acceptRoomAck(
    roomCode: string,
    peerToken: string,
    iceServers: SignalingIceServer[],
  ): void {
    this.roomCode = roomCode;
    this.peerToken = peerToken;
    this.iceServers = iceServers;
    this.createTransportAndManager();
  }

  /** transport + NetworkManager 创建（iceServers 来自 Signaling ROOM ack） */
  private createTransportAndManager(): void {
    if (this.role === null || this.roomCode === null) {
      this.fail({ reason: 'SETUP_FAILED', detail: 'room ack missing before transport creation' });
      return;
    }
    try {
      this.transport = this.options.createTransport(this.role, { iceServers: this.iceServers });
    } catch (error) {
      this.fail({
        reason: 'SETUP_FAILED',
        detail: `transport factory threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    this.manager = new NetworkManager({
      transport: this.transport,
      matchId: this.sessionMatchId(),
      localPlayerId: this.role === 'host' ? 'P1' : 'P2',
    });
    this.cancels.push(
      this.manager.onPong((_envelope: { payload: PingPongPayload }) => this.handleVerified()),
      this.manager.onDisconnect((reason) => {
        // 预 VERIFIED 的任何通道中断 = 连接失败；reason 按 SG-7 分类
        if (!this.verified) {
          this.fail({
            reason: this.classifyTransportLoss(reason ?? 'unknown'),
            detail: `channel lost before verification (${reason ?? 'unknown'})`,
          });
        }
      }),
      // Trickle ICE（SG-4）：本地 candidate 逐个外发；null = 本端 gathering 完结
      this.transport.onLocalIceCandidate((candidate) => {
        const signaling = this.signaling;
        if (signaling === null) {
          return; // fail / 交接后 transport.close 已清 listener —— 防御余波
        }
        if (candidate === null) {
          signaling.sendIceEnd();
          return;
        }
        signaling.sendIceCandidate(candidate);
      }),
    );
  }

  /**
   * SG-7 失败分类：transport 级丢失原因 → ICE_FAILED / TURN_UNAVAILABLE /
   * DATA_CHANNEL_FAILED。ICE/CONNECTION 系 = ICE 协商失败（TURN URL 采集错误
   * 优先归 TURN_UNAVAILABLE —— 中继不可达是严格网络下的可操作诊断）；
   * 其余（CHANNEL_CLOSED/ERROR、超时）归 DATA_CHANNEL_FAILED。
   */
  private classifyTransportLoss(lossDetail: string): RoomConnectionFailureReason {
    if (this.transport?.hasTurnCandidateErrors === true) {
      return 'TURN_UNAVAILABLE';
    }
    if (lossDetail.includes('ICE') || lossDetail.includes('CONNECTION_FAILED')) {
      return 'ICE_FAILED';
    }
    return 'DATA_CHANNEL_FAILED';
  }

  /** 连接期 matchId：双端由同一 roomCode 确定性推导（真实对局 matchId 由 GAME_START 分配） */
  private sessionMatchId(): MatchId {
    return `online-room-${this.roomCode ?? 'unknown'}` as MatchId;
  }

  /** transport 信令 JSON → 原始 SDP（RTCSessionDescriptionInit.sdp 可选 —— 缺失即底层异常） */
  private extractSdp(encoded: string, kind: 'offer' | 'answer'): string | null {
    const description = decodeSignaling(encoded, kind);
    if (description.sdp === undefined) {
      return null;
    }
    return description.sdp;
  }

  // ---- 协商（SG-4：Trickle ICE —— beginOffer/beginAnswer 即返，candidate 独立外发） ----

  /** Host：PEER_JOINED → createOffer → sendOffer（用户零感知） */
  private async hostSendOffer(): Promise<void> {
    const transport = this.transport;
    if (transport === null) {
      this.fail({ reason: 'OFFER_FAILED', detail: 'transport missing at offer' });
      return;
    }
    try {
      const encodedOffer = await transport.beginOffer(); // Trickle：不等 gathering，candidate 随后流出
      if (this.controllerState !== RoomConnectionState.NEGOTIATING || this.signaling === null) {
        return; // 期间已被 fail / PEER_LEFT 接管
      }
      const sdp = this.extractSdp(encodedOffer, 'offer');
      if (sdp === null) {
        this.fail({ reason: 'OFFER_FAILED', detail: 'offer SDP missing' });
        return;
      }
      this.signaling.sendOffer(sdp);
    } catch (error) {
      if (this.controllerState !== RoomConnectionState.FAILED) {
        this.fail({
          reason: 'OFFER_FAILED',
          detail: `host offer failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  /** Host：收 ANSWER → setRemoteDescription → connect + verify */
  private async hostHandleAnswer(sdp: string): Promise<void> {
    const transport = this.transport;
    if (transport === null) {
      this.fail({ reason: 'OFFER_FAILED', detail: 'transport missing at answer' });
      return;
    }
    try {
      await transport.acceptAnswer(JSON.stringify({ type: 'answer', sdp }));
      if (this.controllerState !== RoomConnectionState.NEGOTIATING) {
        return; // 期间已被接管
      }
      await this.connectAndVerify();
    } catch (error) {
      if (this.controllerState !== RoomConnectionState.FAILED) {
        this.fail({
          reason: 'OFFER_FAILED',
          detail: `host apply answer failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  /** Guest：收 OFFER → setRemoteDescription → createAnswer → sendAnswer → connect + verify */
  private async guestHandleOffer(sdp: string): Promise<void> {
    const transport = this.transport;
    if (transport === null) {
      this.fail({ reason: 'ANSWER_FAILED', detail: 'transport missing at offer' });
      return;
    }
    try {
      await transport.acceptOffer(JSON.stringify({ type: 'offer', sdp }));
      const encodedAnswer = await transport.beginAnswer(); // Trickle：不等 gathering，candidate 随后流出
      if (this.controllerState !== RoomConnectionState.NEGOTIATING || this.signaling === null) {
        return;
      }
      const answerSdp = this.extractSdp(encodedAnswer, 'answer');
      if (answerSdp === null) {
        this.fail({ reason: 'ANSWER_FAILED', detail: 'answer SDP missing' });
        return;
      }
      this.signaling.sendAnswer(answerSdp);
      await this.connectAndVerify();
    } catch (error) {
      if (this.controllerState !== RoomConnectionState.FAILED) {
        this.fail({
          reason: 'ANSWER_FAILED',
          detail: `guest answer failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  // ---- 连接 + 验证（复用 Manual 流语义） ------------------------------------

  /**
   * DataChannel open + PING/PONG 验证。
   * 预算：协商窗口剩余时间交 transport.connect（内部 timer 兜底）；connect
   * 成功即清预算 timer（已连会话不得再被预算误杀 —— Manual 流实测教训）。
   */
  private async connectAndVerify(): Promise<void> {
    const transport = this.transport;
    if (transport === null) {
      return;
    }
    const remainingMs = this.negotiationDeadline - Date.now();
    if (remainingMs <= 0) {
      this.fail({ reason: 'DATA_CHANNEL_FAILED', detail: 'negotiation deadline exceeded' });
      return;
    }
    this.clearNegotiationTimer(); // 预算移交 transport.connect 内部 timer
    this.setState(RoomConnectionState.CONNECTING);
    try {
      await transport.connect(remainingMs);
    } catch (error) {
      if (this.controllerState !== RoomConnectionState.FAILED) {
        // connect 期间的 ICE failed 经 handleConnectionLost 记录 lastLossReason
        //（超时无丢失 = null → DATA_CHANNEL_FAILED）
        this.fail({
          reason: this.classifyTransportLoss(transport.lastLossReason ?? ''),
          detail: `data channel failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return;
    }
    if (this.controllerState !== RoomConnectionState.CONNECTING) {
      return; // 期间已被 PEER_LEFT / 断线接管
    }
    this.setState(RoomConnectionState.CONNECTED);
    this.verificationTimer = setTimeout(() => {
      this.fail({ reason: 'VERIFICATION_TIMEOUT' });
    }, this.verificationTimeoutMs);
    this.manager?.ping();
  }

  /** PONG 到达 = 通道双向可用 → VERIFIED + OnlineSession（幂等） */
  private handleVerified(): void {
    if (this.verified) {
      return;
    }
    this.verified = true;
    this.clearTimers();
    this.setState(RoomConnectionState.VERIFIED);
    const role = this.role;
    const manager = this.manager;
    const transport = this.transport;
    const signaling = this.signaling;
    if (role === null || manager === null || transport === null || signaling === null) {
      return;
    }
    const localPlayerId: PlayerId = role === 'host' ? 'P1' : 'P2';
    const session: OnlineSession = {
      role,
      localPlayerId,
      remotePlayerId: localPlayerId === 'P1' ? 'P2' : 'P1',
      transport,
      networkManager: manager,
      signaling,
    };
    // 所有权移交：session（含 signaling）归 SessionManager dispose 链；
    // 本控制器此后只余 detach 语义，destroyAttempt 不得再触碰已交接资源
    this.signaling = null;
    this.transport = null;
    this.manager = null;
    this.cancels.length = 0;
    for (const handler of [...this.sessionHandlers]) {
      try {
        handler(session);
      } catch (error) {
        console.error('[RoomConnection] onSession handler threw:', error);
      }
    }
  }

  // ---- 失败 / 清理 ------------------------------------------------------------

  /** 失败收口：清计时器、销毁尝试、FAILED + 通知（FAILED/CLOSED/VERIFIED 粘滞） */
  private fail(failure: RoomConnectionFailure): void {
    if (
      this.controllerState === RoomConnectionState.FAILED ||
      this.controllerState === RoomConnectionState.CLOSED ||
      this.verified
    ) {
      return;
    }
    this.clearTimers();
    this.failure = failure;
    // 先 settle 真实失败原因，再清资源（destroyAttempt 的泛化 reject 对已 settle 幂等）
    this.rejectFlowDeferred(failure.reason);
    this.destroyAttempt();
    this.setState(RoomConnectionState.FAILED);
    for (const handler of [...this.failureHandlers]) {
      try {
        handler(failure);
      } catch (error) {
        console.error('[RoomConnection] onFailure handler threw:', error);
      }
    }
  }

  /** 尝试资源全清（signaling / transport / manager / 订阅）；不改变状态机 */
  private destroyAttempt(): void {
    this.clearTimers();
    for (const cancel of this.cancels) {
      cancel();
    }
    this.cancels.length = 0;
    this.manager?.dispose();
    this.manager = null;
    this.transport?.close();
    this.transport = null;
    this.signaling?.close();
    this.signaling = null;
    this.role = null;
    this.roomCode = null;
    this.peerToken = null;
    this.iceServers = [];
    this.rejectFlowDeferred('attempt destroyed');
    this.flowDeferred = null;
  }

  private beginNegotiationWindow(): void {
    this.negotiationDeadline = Date.now() + this.negotiationTimeoutMs;
    this.negotiationTimer = setTimeout(() => {
      if (!this.verified) {
        this.fail({ reason: 'DATA_CHANNEL_FAILED', detail: 'negotiation window timed out' });
      }
    }, this.negotiationTimeoutMs);
  }

  private clearNegotiationTimer(): void {
    if (this.negotiationTimer !== null) {
      clearTimeout(this.negotiationTimer);
      this.negotiationTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearNegotiationTimer();
    if (this.verificationTimer !== null) {
      clearTimeout(this.verificationTimer);
      this.verificationTimer = null;
    }
  }

  // ---- 流程 promise / 状态机 ------------------------------------------------

  private makeFlowDeferred(): FlowDeferred {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const deferred: FlowDeferred = {
      promise,
      settled: false,
      settleResolve: () => {
        if (deferred.settled) {
          return;
        }
        deferred.settled = true;
        resolve();
      },
      settleReject: (error: Error) => {
        if (deferred.settled) {
          return;
        }
        deferred.settled = true;
        reject(error);
      },
    };
    return deferred;
  }

  private resolveFlowDeferred(): void {
    this.flowDeferred?.settleResolve();
    this.flowDeferred = null;
  }

  private rejectFlowDeferred(reason: string): void {
    this.flowDeferred?.settleReject(new Error(`[RoomConnection] flow aborted: ${reason}`));
    this.flowDeferred = null;
  }

  private setState(next: RoomConnectionState): void {
    if (this.controllerState === next || this.controllerState === RoomConnectionState.CLOSED) {
      return;
    }
    if (this.controllerState === RoomConnectionState.FAILED && next !== RoomConnectionState.IDLE) {
      return; // FAILED 只能经 retry 复位
    }
    if (this.controllerState === RoomConnectionState.VERIFIED && next !== RoomConnectionState.CLOSED) {
      return; // VERIFIED 是稳定态（Session 层接管生命周期）
    }
    this.controllerState = next;
    for (const handler of [...this.stateHandlers]) {
      try {
        handler(next);
      } catch (error) {
        console.error('[RoomConnection] onStateChange handler threw:', error);
      }
    }
  }
}
