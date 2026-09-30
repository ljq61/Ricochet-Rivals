import type { NetworkEnvelope } from './NetworkEnvelope';
import type { PeerRole } from './PeerRole';
import { TransportError, type NetworkTransport } from './NetworkTransport';
import { TransportState } from './TransportState';
import { DEFAULT_WEBRTC_CONFIG, type WebRTCConfig } from './WebRTCConfig';
import { deserializeEnvelope, serializeEnvelope } from './serialization/NetworkSerializer';
import { decodeSignaling, encodeDescription, waitForIceGatheringComplete } from './signaling/SignalingCodec';
import type { SignalingIceCandidate } from './signaling/SignalingMessage';

/**
 * WebRTC P2P 传输实现（Phase 12 委托②）。
 *
 * * 单一可靠有序 dataChannel（'game'，ordered:true —— 回合制命令禁
 *   maxRetransmits / maxPacketLifeTime 的 partial reliability）。
 * * Offer/Answer 由 Phase 13 信令通道搬运：createOffer → acceptOffer →
 *   createAnswer → acceptAnswer；SDP JSON 编解码与 ICE gathering 等待
 *   由 signaling/SignalingCodec 纯函数承担（F3 拆分，本类 ~320 行）。
 * * wire 与 LocalLoopbackTransport 同构：出站 serializeEnvelope 字符串、
 *   入站 deserializeEnvelope 收敛；垃圾消息记录丢弃，不崩、不改状态。
 * * close() 全清理（底层对象 / DOM listener / 未决 promise / 订阅）且
 *   幂等 —— scene.start 复用 Scene 的重入场景下旧连接不可复活。
 */

const DATA_CHANNEL_LABEL = 'game';
const CONNECT_TIMEOUT_MS = 10_000;

export interface WebRTCTransportOptions {
  readonly role: PeerRole;
  readonly config?: WebRTCConfig;
  /** 测试注入 fake；缺省用浏览器原生 RTCPeerConnection */
  readonly peerConnectionFactory?: (config: WebRTCConfig) => RTCPeerConnection;
}

function defaultPeerConnectionFactory(config: WebRTCConfig): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: config.iceServers });
}

function isDeadState(state: TransportState): boolean {
  return (
    state === TransportState.CLOSED ||
    state === TransportState.FAILED ||
    state === TransportState.DISCONNECTED
  );
}

export class WebRTCTransport implements NetworkTransport {
  private readonly pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private transportState: TransportState = TransportState.IDLE;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: TransportError) => void) | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pendingIceRejects = new Set<(error: TransportError) => void>();
  private readonly messageHandlers = new Set<(message: NetworkEnvelope) => void>();
  private readonly stateChangeHandlers = new Set<(state: TransportState) => void>();
  private readonly disconnectHandlers = new Set<(reason?: string) => void>();
  /** SG-4：本地 ICE candidate 订阅者（null = 本端 gathering 完结） */
  private readonly localIceCandidateHandlers = new Set<(candidate: SignalingIceCandidate | null) => void>();
  /** SG-4：remoteDescription 未 apply 前到达的对端 candidate（apply 后 flush） */
  private readonly pendingRemoteCandidates: SignalingIceCandidate[] = [];
  /** SG-4：candidate 复合键去重（sdpMid + sdpMLineIndex + 文本）——重复投递零成本丢弃 */
  private readonly seenRemoteCandidates = new Set<string>();
  private remoteDescriptionApplied = false;

  constructor(options: WebRTCTransportOptions) {
    const config = options.config ?? DEFAULT_WEBRTC_CONFIG;
    const factory = options.peerConnectionFactory ?? defaultPeerConnectionFactory;
    this.pc = factory(config);
    this.pc.addEventListener('connectionstatechange', this.handleConnectionStateChange);
    this.pc.addEventListener('iceconnectionstatechange', this.handleIceConnectionStateChange);
    this.pc.addEventListener('icecandidate', this.handleIceCandidate);
    if (options.role === 'host') {
      this.attachChannel(this.pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true }));
    } else {
      this.pc.addEventListener('datachannel', this.handleDataChannelEvent);
    }
  }

  // ---- DOM 事件（close 全清理时按引用摘除） ----

  private readonly handleDataChannelEvent = (event: RTCDataChannelEvent): void => {
    this.attachChannel(event.channel);
  };

  private readonly handleChannelOpen = (): void => {
    this.clearConnectTimer();
    this.setState(TransportState.CONNECTED);
    const resolve = this.connectResolve;
    this.clearConnectPending();
    resolve?.();
  };

  private readonly handleChannelMessage = (event: MessageEvent): void => {
    const data = event.data;
    if (typeof data !== 'string') {
      console.warn('[WebRTCTransport] dropped non-string data channel frame');
      return;
    }
    const result = deserializeEnvelope(data);
    if (!result.ok) {
      // 网络垃圾是预期输入：记录丢弃，不崩、状态不变
      console.warn(`[WebRTCTransport] dropped malformed wire message: ${result.error.message}`);
      return;
    }
    for (const handler of [...this.messageHandlers]) {
      handler(result.envelope); // handler 异常向上传播 —— 订阅方（NetworkManager）兜底
    }
  };

  private readonly handleChannelClose = (): void => {
    this.handleConnectionLost(TransportState.DISCONNECTED, 'CHANNEL_CLOSED');
  };

  private readonly handleChannelError = (): void => {
    this.handleConnectionLost(TransportState.FAILED, 'CHANNEL_ERROR');
  };

  private readonly handleConnectionStateChange = (): void => {
    switch (this.pc.connectionState) {
      case 'failed':
        this.handleConnectionLost(TransportState.FAILED, 'CONNECTION_FAILED');
        break;
      case 'closed':
        // 非本端 close()（本端先摘 listener）—— 视为对端 / 底层关闭
        this.handleConnectionLost(TransportState.DISCONNECTED, 'PEER_CLOSED');
        break;
      case 'disconnected':
        // 瞬态：WebRTC 可能自动恢复，不改状态（failed/closed 才是权威终局）
        console.warn('[WebRTCTransport] peer connection transiently disconnected');
        break;
      default:
        break;
    }
  };

  private readonly handleIceConnectionStateChange = (): void => {
    switch (this.pc.iceConnectionState) {
      case 'failed':
        this.handleConnectionLost(TransportState.FAILED, 'ICE_FAILED');
        break;
      case 'closed':
        this.handleConnectionLost(TransportState.DISCONNECTED, 'ICE_CLOSED');
        break;
      case 'disconnected':
        console.warn('[WebRTCTransport] ICE transiently disconnected');
        break;
      default:
        break;
    }
  };

  /** SG-4：本地 candidate 事件（browser contract：candidate === null = gathering 完结） */
  private readonly handleIceCandidate = (event: RTCPeerConnectionIceEvent): void => {
    const candidate = event.candidate;
    if (candidate === null) {
      for (const handler of [...this.localIceCandidateHandlers]) {
        handler(null);
      }
      return;
    }
    const mapped: SignalingIceCandidate = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment,
    };
    for (const handler of [...this.localIceCandidateHandlers]) {
      handler(mapped);
    }
  };

  // ---- NetworkTransport 接口 ----

  get state(): TransportState {
    return this.transportState;
  }

  get connected(): boolean {
    return this.transportState === TransportState.CONNECTED;
  }

  /** 等 dataChannel 'open'；超时迁移 FAILED + reject TransportError('CONNECT_FAILED')。
   *  timeoutMs = Infinity：开放等待（Phase 13 手动配对 Guest —— Host 应用
   *  Answer 前通道不可能 open，人肉传码是分钟级窗口，不受 open 超时约束；
   *  失败仍由 ICE/连接 failed 与 close() 兜底 reject）。 */
  connect(timeoutMs: number = CONNECT_TIMEOUT_MS): Promise<void> {
    if (this.transportState === TransportState.CONNECTED) {
      return Promise.resolve();
    }
    if (isDeadState(this.transportState)) {
      return Promise.reject(
        new TransportError(
          'TRANSPORT_CLOSED',
          `[WebRTCTransport] cannot connect: transport is ${this.transportState} — 重连需新建 transport`,
        ),
      );
    }
    if (this.connectPromise !== null) {
      return this.connectPromise; // CONNECTING 中重复调用：复用同一 promise
    }
    this.setState(TransportState.CONNECTING);
    const promise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    this.connectPromise = promise;
    // setTimeout(fn, Infinity) 会被浏览器当 0 立即触发 —— 非有限值不挂 timer
    if (Number.isFinite(timeoutMs)) {
      this.connectTimer = setTimeout(() => {
        this.failConnect(
          new TransportError('CONNECT_FAILED', '[WebRTCTransport] connect timed out: data channel never opened'),
        );
      }, timeoutMs);
    }
    if (this.dataChannel !== null && this.dataChannel.readyState === 'open') {
      this.handleChannelOpen(); // open 事件先于 connect()：直接完成
    }
    return promise;
  }

  send(message: NetworkEnvelope): void {
    if (this.transportState === TransportState.CLOSED || this.transportState === TransportState.FAILED) {
      throw new TransportError(
        'TRANSPORT_CLOSED',
        `[WebRTCTransport] send rejected: transport is ${this.transportState}`,
      );
    }
    const channel = this.dataChannel;
    if (channel === null || channel.readyState !== 'open') {
      throw new TransportError(
        'NOT_CONNECTED',
        `[WebRTCTransport] send rejected: data channel is ${channel === null ? 'absent' : channel.readyState}`,
      );
    }
    const wire = serializeEnvelope(message); // 坏 envelope 立刻抛，永不静默
    channel.send(wire);
  }

  onMessage(handler: (message: NetworkEnvelope) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: TransportState) => void): () => void {
    this.stateChangeHandlers.add(handler);
    return () => {
      this.stateChangeHandlers.delete(handler);
    };
  }

  onDisconnect(handler: (reason?: string) => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }

  /** 全清理 + 幂等：重入 Online 后旧连接 / 旧 listener 不可复活 */
  close(): void {
    if (this.transportState === TransportState.CLOSED) {
      return;
    }
    // 1) 先摘全部 DOM listener —— teardown 自身不触发任何 spurious 回调
    this.pc.removeEventListener('connectionstatechange', this.handleConnectionStateChange);
    this.pc.removeEventListener('iceconnectionstatechange', this.handleIceConnectionStateChange);
    this.pc.removeEventListener('icecandidate', this.handleIceCandidate);
    this.pc.removeEventListener('datachannel', this.handleDataChannelEvent);
    const channel = this.dataChannel;
    if (channel !== null) {
      channel.removeEventListener('open', this.handleChannelOpen);
      channel.removeEventListener('message', this.handleChannelMessage);
      channel.removeEventListener('close', this.handleChannelClose);
      channel.removeEventListener('error', this.handleChannelError);
    }
    // 2) 结清未决 promise（connect / ICE 等待）
    this.clearConnectTimer();
    const reject = this.connectReject;
    this.clearConnectPending();
    reject?.(new TransportError('TRANSPORT_CLOSED', '[WebRTCTransport] closed while connecting'));
    if (this.pendingIceRejects.size > 0) {
      const iceError = new TransportError('TRANSPORT_CLOSED', '[WebRTCTransport] closed during ICE gathering');
      for (const rejectIce of [...this.pendingIceRejects]) {
        rejectIce(iceError);
      }
      this.pendingIceRejects.clear();
    }
    // 3) 关闭底层对象
    channel?.close();
    this.pc.close();
    this.dataChannel = null;
    // 4) 终态 + 清订阅
    this.setState(TransportState.CLOSED);
    this.messageHandlers.clear();
    this.stateChangeHandlers.clear();
    this.disconnectHandlers.clear();
    this.localIceCandidateHandlers.clear();
    this.pendingRemoteCandidates.length = 0;
    this.seenRemoteCandidates.clear();
  }

  // ---- Offer / Answer（Phase 13 手动流：全量 gather SDP —— ICE 收齐再返回） ----

  async createOffer(): Promise<string> {
    const encoded = await this.beginOffer();
    await waitForIceGatheringComplete(this.pc, this.pendingIceRejects);
    return encoded;
  }

  async acceptOffer(encodedOffer: string): Promise<void> {
    this.assertAliveForSignaling('acceptOffer');
    await this.pc.setRemoteDescription(decodeSignaling(encodedOffer, 'offer'));
    this.remoteDescriptionApplied = true;
    await this.flushPendingRemoteCandidates();
  }

  async createAnswer(): Promise<string> {
    const encoded = await this.beginAnswer();
    await waitForIceGatheringComplete(this.pc, this.pendingIceRejects);
    return encoded;
  }

  async acceptAnswer(encodedAnswer: string): Promise<void> {
    this.assertAliveForSignaling('acceptAnswer');
    await this.pc.setRemoteDescription(decodeSignaling(encodedAnswer, 'answer'));
    this.remoteDescriptionApplied = true;
    await this.flushPendingRemoteCandidates();
  }

  // ---- Trickle ICE（SG-4，Room 流；Manual 流不使用本段） -------------------

  /** createOffer + setLocalDescription 即返 —— 不等 gathering；本地 candidate 随后经 onLocalIceCandidate 流出 */
  async beginOffer(): Promise<string> {
    this.assertAliveForSignaling('beginOffer');
    const description = await this.pc.createOffer();
    await this.pc.setLocalDescription(description);
    return encodeDescription(this.pc.localDescription ?? description);
  }

  /** createAnswer + setLocalDescription 即返 —— 不等 gathering */
  async beginAnswer(): Promise<string> {
    this.assertAliveForSignaling('beginAnswer');
    const description = await this.pc.createAnswer();
    await this.pc.setLocalDescription(description);
    return encodeDescription(this.pc.localDescription ?? description);
  }

  /** 本地 ICE candidate 事件（browser contract：null = 本端 gathering 完结 → 对端发 ICE_END） */
  onLocalIceCandidate(handler: (candidate: SignalingIceCandidate | null) => void): () => void {
    this.localIceCandidateHandlers.add(handler);
    return () => {
      this.localIceCandidateHandlers.delete(handler);
    };
  }

  /**
   * 接收对端 candidate（Untrusted Input —— 网络来的东西不致命）：
   * * remoteDescription 未 apply → 内部队列，apply 后按序 flush
   *   （candidate 先于 Offer/Answer 到达是 Trickle 常态，不阻塞协商）
   * * candidate 文本重复 → 丢弃
   * * addIceCandidate 失败（畸形候选）→ 记录不崩，后续合法候选不受影响
   */
  addIceCandidate(candidate: SignalingIceCandidate): void {
    if (isDeadState(this.transportState)) {
      console.debug('[WebRTCTransport] addIceCandidate dropped: transport dead');
      return;
    }
    const key = `${candidate.sdpMid ?? ''}|${candidate.sdpMLineIndex ?? ''}|${candidate.candidate}`;
    if (this.seenRemoteCandidates.has(key)) {
      console.debug('[WebRTCTransport] duplicate candidate dropped');
      return;
    }
    this.seenRemoteCandidates.add(key);
    if (!this.remoteDescriptionApplied) {
      this.pendingRemoteCandidates.push(candidate);
      return;
    }
    void this.applyRemoteCandidate(candidate);
  }

  private async applyRemoteCandidate(candidate: SignalingIceCandidate): Promise<void> {
    try {
      // SignalingIceCandidate 结构兼容 RTCIceCandidateInit（协议测试含编译期断言）
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn('[WebRTCTransport] addIceCandidate rejected (dropped):', error);
    }
  }

  private async flushPendingRemoteCandidates(): Promise<void> {
    const queued = [...this.pendingRemoteCandidates];
    this.pendingRemoteCandidates.length = 0;
    for (const candidate of queued) {
      await this.applyRemoteCandidate(candidate);
    }
  }

  // ---- 内部 ----

  private attachChannel(channel: RTCDataChannel): void {
    if (this.dataChannel !== null) {
      return; // 只接第一条（防御重复 ondatachannel）
    }
    this.dataChannel = channel;
    channel.addEventListener('open', this.handleChannelOpen);
    channel.addEventListener('message', this.handleChannelMessage);
    channel.addEventListener('close', this.handleChannelClose);
    channel.addEventListener('error', this.handleChannelError);
  }

  private handleConnectionLost(targetState: TransportState, reason: string): void {
    if (this.transportState === TransportState.CLOSED) {
      return;
    }
    // FAILED 粘滞（F2）：连接失败是权威终局，后续 channel close / ICE closed
    // 事件只是同一失败的余波 —— 不降级为 DISCONNECTED，也不重复触发 onDisconnect
    if (this.transportState === TransportState.FAILED) {
      return;
    }
    if (this.transportState === TransportState.CONNECTING) {
      this.failConnect(
        new TransportError('CONNECT_FAILED', `[WebRTCTransport] connection lost during handshake (${reason})`),
      );
      return;
    }
    if (this.setState(targetState)) {
      this.fireDisconnect(reason);
    }
  }

  private failConnect(error: TransportError): void {
    this.clearConnectTimer();
    const reject = this.connectReject;
    this.clearConnectPending();
    this.setState(TransportState.FAILED);
    reject?.(error);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearConnectPending(): void {
    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
  }

  private fireDisconnect(reason: string): void {
    for (const handler of [...this.disconnectHandlers]) {
      handler(reason);
    }
  }

  private setState(next: TransportState): boolean {
    if (this.transportState === next) {
      return false;
    }
    this.transportState = next;
    for (const handler of [...this.stateChangeHandlers]) {
      handler(next);
    }
    return true;
  }

  private assertAliveForSignaling(operation: string): void {
    if (isDeadState(this.transportState)) {
      throw new TransportError(
        'TRANSPORT_CLOSED',
        `[WebRTCTransport] ${operation} rejected: transport is ${this.transportState}`,
      );
    }
  }
}
