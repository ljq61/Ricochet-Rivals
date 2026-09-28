import { OnlineConnectionState } from './OnlineConnectionState';
import { WebRTCTransport } from './WebRTCTransport';
import { NetworkManager, type PingPongPayload } from './NetworkManager';
import { TransportError } from './NetworkTransport';
import type { MatchId, PlayerId } from '../state/ids';
import type { PeerRole } from './PeerRole';
import type { OnlineSession } from './OnlineSession';
import {
  decodeConnectionCode,
  encodeConnectionCode,
  type ConnectionCodePayload,
} from './signaling/ConnectionCodeCodec';
import { decodeSignaling } from './signaling/SignalingCodec';

/**
 * OnlineConnectionController（Phase 13）—— 手动配对流程编排器。
 *
 * OnlineConnectionScene（UI）→ 本类 → NetworkManager → WebRTCTransport。
 * Scene 只渲染状态与转发用户输入；**禁止 Scene 直接调用 RTC API**。
 *
 * 职责：Host / Guest 双流程、状态机转移、连接码桥接、连接超时兜底、
 * PING/PONG 验证、retry / back 彻底清理、防重复动作。
 *
 * 超时分层：transport.connect 自带 10s（通道打开主超时）；
 * 本类 CONNECT_TOTAL_TIMEOUT_MS=20s 为 transport 事件缺失的兜底预算；
 * 验证阶段 VERIFICATION_TIMEOUT_MS=10s 内无 PONG → FAILED。
 *
 * Host = P1 / Guest = P2 固定（Phase 13 规则）。
 */

export interface OnlineConnectionControllerOptions {
  /** 每次会话新建 transport 的工厂（retry 重建用；测试注入 fake RTC） */
  readonly createTransport: (role: PeerRole) => WebRTCTransport;
  readonly matchId: MatchId;
  /** 连接总预算（默认 20s，15~30s 区间） */
  readonly connectTimeoutMs?: number;
}

/** 用户可读失败消息（技术错误只进 console.debug，不进 UI） */
export const ONLINE_FAILURE_MESSAGES = {
  invalidCode: 'Invalid connection code',
  setupFailed: 'Connection setup failed',
  timedOut: 'Connection timed out',
  closed: 'Connection was closed',
  unsupported: 'Browser does not support WebRTC',
  verificationFailed: 'Connection unstable — verification failed',
} as const;

/** 连接总预算兜底（transport.connect 自身 10s 为主超时） */
const CONNECT_TOTAL_TIMEOUT_MS = 20_000;
/** CONNECTED 后 PING/PONG 验证窗口 */
const VERIFICATION_TIMEOUT_MS = 10_000;

type StateHandler = (state: OnlineConnectionState) => void;
type FailureHandler = (userMessage: string) => void;
type SessionHandler = (session: OnlineSession) => void;

export class OnlineConnectionController {
  private readonly options: OnlineConnectionControllerOptions;

  private state: OnlineConnectionState = OnlineConnectionState.CHOOSE_ROLE;
  private transport: WebRTCTransport | null = null;
  private manager: NetworkManager | null = null;
  private role: PeerRole | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private verificationTimer: ReturnType<typeof setTimeout> | null = null;
  /** 防重复动作：进行中的 host offer / guest answer promise */
  private hostSessionPromise: Promise<{ connectionCode: string }> | null = null;
  private guestAnswerPromise: Promise<{ responseCode: string }> | null = null;
  private disposed = false;

  private readonly stateHandlers = new Set<StateHandler>();
  private readonly failureHandlers = new Set<FailureHandler>();
  private readonly sessionHandlers = new Set<SessionHandler>();
  private readonly managerCancels: Array<() => void> = [];

  constructor(options: OnlineConnectionControllerOptions) {
    this.options = options;
  }

  get currentState(): OnlineConnectionState {
    return this.state;
  }

  // ---- 订阅（Scene 消费；handler 异常不逃逸） ----------------------------

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

  /** VERIFIED 时回调（session 交给 OnlineSessionManager 前的观察口） */
  onSession(handler: SessionHandler): () => void {
    this.sessionHandlers.add(handler);
    return () => {
      this.sessionHandlers.delete(handler);
    };
  }

  // ---- Host flow ---------------------------------------------------------

  /**
   * Host：建会话并生成 Offer Code（重复调用复用同一 promise，不重复建 PeerConnection）。
   * 状态：CHOOSE_ROLE → HOST_CREATING_OFFER → HOST_WAITING_FOR_ANSWER
   */
  async createHostSession(): Promise<{ connectionCode: string }> {
    if (this.hostSessionPromise !== null) {
      return this.hostSessionPromise;
    }
    if (this.state !== OnlineConnectionState.CHOOSE_ROLE) {
      throw new TransportError('NOT_CONNECTED', `[OnlineConnection] createHostSession requires CHOOSE_ROLE (current: ${this.state})`);
    }
    const promise = this.runHostOffer();
    this.hostSessionPromise = promise;
    try {
      return await promise;
    } finally {
      this.hostSessionPromise = null;
    }
  }

  private async runHostOffer(): Promise<{ connectionCode: string }> {
    this.startSession('host');
    this.setState(OnlineConnectionState.HOST_CREATING_OFFER);
    try {
      const signalingJson = await this.transport?.createOffer();
      if (!this.transport || signalingJson === undefined) {
        throw new TransportError('TRANSPORT_CLOSED', '[OnlineConnection] session destroyed during offer creation');
      }
      const sdp = this.extractSdp(signalingJson, 'offer');
      const connectionCode = encodeConnectionCode({ version: 1, kind: 'offer', sdp });
      this.setState(OnlineConnectionState.HOST_WAITING_FOR_ANSWER);
      return { connectionCode };
    } catch (error) {
      this.failWith(error, 'setupFailed');
      throw error;
    }
  }

  /**
   * Host：粘贴 Guest Response Code 并连接验证。
   * 阶段外 / 重复调用 → 静默忽略（防重复 setRemoteDescription race）。
   */
  async submitAnswerCode(raw: string): Promise<void> {
    if (this.state !== OnlineConnectionState.HOST_WAITING_FOR_ANSWER) {
      console.debug(`[OnlineConnection] submitAnswerCode ignored (state: ${this.state})`);
      return;
    }
    const decoded = decodeConnectionCode(raw, 'answer');
    if (!decoded.ok) {
      this.emitFailure(ONLINE_FAILURE_MESSAGES.invalidCode);
      return; // 保留输入界面：用户可直接重新 Paste（PeerConnection 仍有效）
    }
    this.setState(OnlineConnectionState.HOST_APPLYING_ANSWER);
    try {
      await this.applyRemoteAndConnect('answer', decoded.payload);
    } catch (error) {
      this.failWith(error, 'setupFailed');
    }
  }

  // ---- Guest flow ---------------------------------------------------------

  /** Guest：进入等待输入界面（未带 lazy start 时显式调用） */
  startGuestSession(): void {
    if (this.state !== OnlineConnectionState.CHOOSE_ROLE) {
      return;
    }
    this.startSession('guest');
    this.setState(OnlineConnectionState.GUEST_WAITING_FOR_OFFER);
  }

  /**
   * Guest：粘贴 Host Code → 生成 Response Code；同时后台等 Host 接受 → 连接验证。
   * 重复调用复用同一 promise；CHOOSE_ROLE 时 lazy start。
   */
  async submitOfferCode(raw: string): Promise<{ responseCode: string }> {
    if (this.guestAnswerPromise !== null) {
      return this.guestAnswerPromise;
    }
    if (this.state === OnlineConnectionState.CHOOSE_ROLE) {
      this.startGuestSession(); // lazy start（首屏直接粘贴）
    }
    if (this.state !== OnlineConnectionState.GUEST_WAITING_FOR_OFFER) {
      throw new TransportError('NOT_CONNECTED', `[OnlineConnection] submitOfferCode requires GUEST_WAITING_FOR_OFFER (current: ${this.state})`);
    }
    const decoded = decodeConnectionCode(raw, 'offer');
    if (!decoded.ok) {
      this.emitFailure(ONLINE_FAILURE_MESSAGES.invalidCode);
      throw new TransportError('INVALID_SIGNALING', `[OnlineConnection] offer code rejected: ${decoded.reason}`);
    }
    const promise = this.runGuestAnswer(decoded.payload);
    this.guestAnswerPromise = promise;
    try {
      return await promise;
    } finally {
      this.guestAnswerPromise = null;
    }
  }

  private async runGuestAnswer(offerPayload: ConnectionCodePayload): Promise<{ responseCode: string }> {
    this.setState(OnlineConnectionState.GUEST_CREATING_ANSWER);
    try {
      const transport = this.transport;
      if (!transport) {
        throw new TransportError('TRANSPORT_CLOSED', '[OnlineConnection] session destroyed during answer creation');
      }
      await transport.acceptOffer(JSON.stringify({ type: 'offer', sdp: offerPayload.sdp }));
      const signalingJson = await transport.createAnswer();
      const sdp = this.extractSdp(signalingJson, 'answer');
      const responseCode = encodeConnectionCode({ version: 1, kind: 'answer', sdp });
      this.setState(OnlineConnectionState.GUEST_WAITING_FOR_HOST);
      // Response 已可回传 Host；连接在后台推进（Host acceptAnswer 后通道打开）
      void this.connectAndVerify();
      return { responseCode };
    } catch (error) {
      this.failWith(error, 'setupFailed');
      throw error;
    }
  }

  // ---- 连接 + 验证 ---------------------------------------------------------

  /** CONNECTING → (connect) → CONNECTED → ping/pong → VERIFIED；失败走 fail() */
  private async connectAndVerify(): Promise<void> {
    this.setState(OnlineConnectionState.CONNECTING);

    // 总预算兜底（transport.connect 自身 10s 为主要超时；timer 触发即 FAILED）
    this.connectTimer = setTimeout(() => {
      this.fail(ONLINE_FAILURE_MESSAGES.timedOut);
    }, this.options.connectTimeoutMs ?? CONNECT_TOTAL_TIMEOUT_MS);

    try {
      await this.transport?.connect();
    } catch (error) {
      this.failWith(error, 'timedOut');
      return;
    }
    if (this.state !== OnlineConnectionState.CONNECTING) {
      return; // 期间已被 fail / back 接管
    }
    this.setState(OnlineConnectionState.CONNECTED);

    // PING/PONG 验证：10s 内无 PONG → FAILED（connection unstable）
    this.verificationTimer = setTimeout(() => {
      this.fail(ONLINE_FAILURE_MESSAGES.verificationFailed);
    }, VERIFICATION_TIMEOUT_MS);

    const manager = this.manager;
    if (!manager) {
      this.fail(ONLINE_FAILURE_MESSAGES.closed);
      return;
    }
    manager.ping();
    // PONG 到达即验证通过（onPong 在 connectAndVerify 内注册，一次性）
  }

  /** VERIFIED：产出 OnlineSession 并通知（Session 交给 OnlineSessionManager）；
   *  幂等 —— controller 的 PONG 订阅在 VERIFIED 后仍存活（区间 ping 的 PONG
   *  持续到达），重复触发不得反复重建 session / dispose 旧连接 */
  private handleVerified(): void {
    if (this.state === OnlineConnectionState.VERIFIED) {
      return;
    }
    this.clearTimers();
    this.setState(OnlineConnectionState.VERIFIED);
    if (this.role === null || this.manager === null || this.transport === null) {
      return;
    }
    const localPlayerId: PlayerId = this.role === 'host' ? 'P1' : 'P2';
    const session: OnlineSession = {
      role: this.role,
      localPlayerId,
      remotePlayerId: localPlayerId === 'P1' ? 'P2' : 'P1',
      transport: this.transport,
      networkManager: this.manager,
    };
    for (const handler of [...this.sessionHandlers]) {
      try {
        handler(session);
      } catch (error) {
        console.error('[OnlineConnection] onSession handler threw:', error);
      }
    }
  }

  // ---- 生命周期 -------------------------------------------------------------

  /** Retry：彻底销毁当前会话回 CHOOSE_ROLE（不复活 failed PeerConnection） */
  retry(): void {
    this.destroySession();
    this.setState(OnlineConnectionState.CHOOSE_ROLE);
  }

  /** Back / 退出：彻底清理并 CLOSED（后台 RTC 连接不得残留） */
  back(): void {
    this.destroySession();
    this.setState(OnlineConnectionState.CLOSED);
  }

  /** Controller 生命周期终了（Scene shutdown 等）；幂等 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.destroySession();
    this.stateHandlers.clear();
    this.failureHandlers.clear();
    this.sessionHandlers.clear();
    this.state = OnlineConnectionState.CLOSED;
  }

  // ---- 内部 -----------------------------------------------------------------

  /** transport 信令 JSON → 原始 SDP 文本（SignalingCodec 已保证非空，这里窄化） */
  private extractSdp(signalingJson: string, kind: 'offer' | 'answer'): string {
    const signaling = decodeSignaling(signalingJson, kind);
    if (signaling.sdp === undefined) {
      throw new TransportError('INVALID_SIGNALING', '[OnlineConnection] transport signaling missing SDP');
    }
    return signaling.sdp;
  }

  private startSession(role: PeerRole): void {
    this.role = role;
    let transport: WebRTCTransport;
    try {
      transport = this.options.createTransport(role);
    } catch (error) {
      console.debug('[OnlineConnection] transport factory threw:', error);
      // 工厂失败（无 RTC 支持 / 底层异常）→ unsupported 是唯一可靠分类
      this.fail(ONLINE_FAILURE_MESSAGES.unsupported);
      throw error;
    }
    this.transport = transport;
    this.manager = new NetworkManager({
      transport,
      matchId: this.options.matchId,
      localPlayerId: role === 'host' ? 'P1' : 'P2',
    });
    // PONG 到达 = 通道双向可用 → VERIFIED
    this.managerCancels.push(
      this.manager.onPong((_envelope: { payload: PingPongPayload }) => this.handleVerified())
    );
    // 连接建立前对端关闭 → FAILED（closed）；VERIFIED 后由 Session 层处理断线（Phase 14+）
    this.managerCancels.push(
      this.manager.onDisconnect(() => {
        if (this.state !== OnlineConnectionState.VERIFIED) {
          this.fail(ONLINE_FAILURE_MESSAGES.closed);
        }
      })
    );
  }

  /** Host/Guest 共用：应用远端信令 → connectAndVerify（Guest 由 runGuestAnswer 后台调） */
  private async applyRemoteAndConnect(kind: 'offer' | 'answer', payload: ConnectionCodePayload): Promise<void> {
    const transport = this.transport;
    if (!transport) {
      throw new TransportError('TRANSPORT_CLOSED', '[OnlineConnection] no active session');
    }
    if (kind === 'answer') {
      await transport.acceptAnswer(JSON.stringify({ type: 'answer', sdp: payload.sdp }));
    }
    await this.connectAndVerify();
  }

  /** 失败收口：清计时器、销毁会话、FAILED + 用户消息；FAILED/CLOSED/VERIFIED 不再转移 */
  private fail(userMessage: string): void {
    if (
      this.state === OnlineConnectionState.FAILED ||
      this.state === OnlineConnectionState.CLOSED ||
      this.state === OnlineConnectionState.VERIFIED
    ) {
      return;
    }
    this.clearTimers();
    this.destroySession();
    this.setState(OnlineConnectionState.FAILED);
    this.emitFailure(userMessage);
  }

  /** 技术错误分类 → 用户可读消息（技术细节进 console.debug）。
   * unsupported 只由 transport factory 失败路径产生（startSession）——
   * 运行期 connect/信令失败不能凭全局 RTCPeerConnection 存在性误判。 */
  private failWith(error: unknown, fallbackKind: keyof typeof ONLINE_FAILURE_MESSAGES): void {
    console.debug('[OnlineConnection] connection flow error:', error);
    if (error instanceof TransportError && error.reason === 'INVALID_SIGNALING') {
      this.fail(ONLINE_FAILURE_MESSAGES.invalidCode);
      return;
    }
    this.fail(ONLINE_FAILURE_MESSAGES[fallbackKind]);
  }

  private destroySession(): void {
    this.clearTimers();
    for (const cancel of this.managerCancels) {
      cancel();
    }
    this.managerCancels.length = 0;
    this.manager?.dispose();
    this.manager = null;
    this.transport?.close();
    this.transport = null;
    this.role = null;
    this.hostSessionPromise = null;
    this.guestAnswerPromise = null;
  }

  private clearTimers(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.verificationTimer !== null) {
      clearTimeout(this.verificationTimer);
      this.verificationTimer = null;
    }
  }

  private setState(state: OnlineConnectionState): void {
    if (this.state === state || this.state === OnlineConnectionState.CLOSED) {
      return;
    }
    if (this.state === OnlineConnectionState.FAILED && state !== OnlineConnectionState.CHOOSE_ROLE) {
      return; // FAILED 只能经 retry 复位
    }
    if (this.state === OnlineConnectionState.VERIFIED && state !== OnlineConnectionState.CLOSED) {
      return; // VERIFIED 是稳定态（Session 层接管生命周期）
    }
    this.state = state;
    for (const handler of [...this.stateHandlers]) {
      try {
        handler(state);
      } catch (error) {
        console.error('[OnlineConnection] onStateChange handler threw:', error);
      }
    }
  }

  private emitFailure(userMessage: string): void {
    for (const handler of [...this.failureHandlers]) {
      try {
        handler(userMessage);
      } catch (error) {
        console.error('[OnlineConnection] onFailure handler threw:', error);
      }
    }
  }
}
