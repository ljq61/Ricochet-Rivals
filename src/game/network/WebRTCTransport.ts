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

/** SG-6 诊断：selected candidate pair（getStats 解析） */
export interface SelectedCandidatePair {
  readonly localType: string | null;
  readonly remoteType: string | null;
  readonly localProtocol: string | null;
  readonly remoteProtocol: string | null;
  readonly localAddress: string | null;
  readonly remoteAddress: string | null;
  /** relay 时 TURN transport 协议（udp/tcp/tls）—— 直连为 null */
  readonly relayProtocol: string | null;
}

/** SG-6 诊断快照（Connection Diagnostics 规格；route = DIRECT / TURN RELAY） */
export interface WebRTCDiagnostics {
  readonly transportState: TransportState;
  readonly connectionState: RTCPeerConnectionState;
  readonly iceConnectionState: RTCIceConnectionState;
  readonly iceGatheringState: RTCIceGatheringState;
  readonly signalingState: RTCSignalingState;
  readonly localCandidateTypes: string[];
  readonly iceCandidateErrorCount: number;
  readonly lastIceCandidateError: string | null;
  readonly selectedPair: SelectedCandidatePair | null;
  readonly route: 'DIRECT' | 'RELAY' | null;
}

function defaultPeerConnectionFactory(config: WebRTCConfig): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: config.iceServers,
    iceTransportPolicy: config.iceTransportPolicy,
  });
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
  /** SG-6 诊断：本地 candidate 类型（host / srflx / relay —— handleIceCandidate 解析收集） */
  private readonly localCandidateTypes = new Set<string>();
  /** SG-6 诊断：icecandidateerror 计数与最近错误（TURN 不可达排查） */
  private iceCandidateErrorCount = 0;
  private lastIceCandidateError: string | null = null;
  /** SG-7：最近一次连接丢失的 transport 级原因（handleConnectionLost 记录；超时无丢失为 null） */
  private lastLossReasonValue: string | null = null;

  /** SG-7：最近连接丢失原因（'ICE_FAILED' / 'CHANNEL_CLOSED' / …；超时为 null）——失败分类输入 */
  get lastLossReason(): string | null {
    return this.lastLossReasonValue;
  }

  /** SG-7：ICE candidate 采集是否命中 TURN URL 错误（中继不可达判定） */
  get hasTurnCandidateErrors(): boolean {
    return this.iceCandidateErrorCount > 0 && (this.lastIceCandidateError?.includes('turn:') ?? false);
  }

  constructor(options: WebRTCTransportOptions) {
    const config = options.config ?? DEFAULT_WEBRTC_CONFIG;
    const factory = options.peerConnectionFactory ?? defaultPeerConnectionFactory;
    this.pc = factory(config);
    this.pc.addEventListener('connectionstatechange', this.handleConnectionStateChange);
    this.pc.addEventListener('iceconnectionstatechange', this.handleIceConnectionStateChange);
    this.pc.addEventListener('icecandidate', this.handleIceCandidate);
    this.pc.addEventListener('icecandidateerror', this.handleIceCandidateError);
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
    // SG-6 诊断：candidate 文本含 'typ <host|srflx|relay|prflx>' —— 收集本地类型
    const typeMatch = /typ (\w+)/.exec(candidate.candidate);
    if (typeMatch !== null) {
      this.localCandidateTypes.add(typeMatch[1] ?? '');
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

  /** SG-6 诊断：ICE 候选采集错误（TURN/STUN 不可达等 —— 计数不崩） */
  private readonly handleIceCandidateError = (event: RTCPeerConnectionIceErrorEvent): void => {
    this.iceCandidateErrorCount += 1;
    const target = event as unknown as { url?: string; errorCode?: number; errorText?: string };
    this.lastIceCandidateError = `${target.url ?? 'unknown'} ${target.errorCode ?? ''} ${target.errorText ?? ''}`.trim();
  };

  /**
   * SG-6 诊断快照（Connection Diagnostics 规格）：ICE 各层状态 + 本地
   * candidate 类型 + selected candidate pair（getStats 解析）→ 直观判定
   * DIRECT / TURN RELAY。Debug Overlay / E2E 消费；正式 UI 不展示底层细节。
   */
  async getDiagnostics(): Promise<WebRTCDiagnostics> {
    const selectedPair = await this.readSelectedCandidatePair();
    const relayed = selectedPair !== null && (selectedPair.localType === 'relay' || selectedPair.remoteType === 'relay');
    return {
      transportState: this.transportState,
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      signalingState: this.pc.signalingState,
      localCandidateTypes: [...this.localCandidateTypes],
      iceCandidateErrorCount: this.iceCandidateErrorCount,
      lastIceCandidateError: this.lastIceCandidateError,
      selectedPair,
      route: selectedPair === null ? null : relayed ? 'RELAY' : 'DIRECT',
    };
  }

  /** getStats 解析 selected pair（local/remote candidate 类型）—— 无 stats / 未选中 → null */
  private async readSelectedCandidatePair(): Promise<SelectedCandidatePair | null> {
    if (typeof this.pc.getStats !== 'function') {
      return null;
    }
    let report: RTCStatsReport;
    try {
      report = await this.pc.getStats();
    } catch (error) {
      console.debug('[WebRTCTransport] getStats failed:', error);
      return null;
    }
    interface CandidateStat {
      id: string;
      candidateType?: string;
      protocol?: string;
      address?: string;
      port?: number;
      relayProtocol?: string;
    }
    const candidates = new Map<string, CandidateStat>();
    // 持有对象规避 TS 控制流收窄（回调内赋值不计入 —— 直接 let 会收窄成 null/never）
    const result: { selected: { localCandidateId?: string; remoteCandidateId?: string } | null } = {
      selected: null,
    };
    report.forEach((stat) => {
      const entry = stat as unknown as Record<string, unknown>;
      const type = entry['type'];
      if (type === 'local-candidate' || type === 'remote-candidate') {
        candidates.set(String(entry['id'] ?? ''), {
          id: String(entry['id'] ?? ''),
          candidateType: typeof entry['candidateType'] === 'string' ? entry['candidateType'] : undefined,
          protocol: typeof entry['protocol'] === 'string' ? entry['protocol'] : undefined,
          address: typeof entry['address'] === 'string' ? entry['address'] : undefined,
          port: typeof entry['port'] === 'number' ? entry['port'] : undefined,
          relayProtocol: typeof entry['relayProtocol'] === 'string' ? entry['relayProtocol'] : undefined,
        });
      } else if (type === 'candidate-pair') {
        const isSelected = entry['selected'] === true || (entry['nominated'] === true && entry['state'] === 'succeeded');
        if (isSelected) {
          result.selected = {
            localCandidateId: typeof entry['localCandidateId'] === 'string' ? entry['localCandidateId'] : undefined,
            remoteCandidateId: typeof entry['remoteCandidateId'] === 'string' ? entry['remoteCandidateId'] : undefined,
          };
        }
      }
    });
    const selected = result.selected;
    if (selected === null) {
      return null;
    }
    const local = selected.localCandidateId !== undefined ? candidates.get(selected.localCandidateId) : undefined;
    const remote = selected.remoteCandidateId !== undefined ? candidates.get(selected.remoteCandidateId) : undefined;
    if (local === undefined || remote === undefined) {
      return null;
    }
    return {
      localType: local.candidateType ?? null,
      remoteType: remote.candidateType ?? null,
      localProtocol: local.protocol ?? null,
      remoteProtocol: remote.protocol ?? null,
      localAddress: local.address ?? null,
      remoteAddress: remote.address ?? null,
      relayProtocol: local.relayProtocol ?? null,
    };
  }

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
    this.pc.removeEventListener('icecandidateerror', this.handleIceCandidateError);
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
    this.localCandidateTypes.clear();
  }

  // ---- Offer / Answer（Phase 13 手动流：全量 gather SDP —— ICE 收齐再返回） ----

  async createOffer(): Promise<string> {
    await this.beginOffer(); // setLocalDescription（其返回快照不含 candidate，弃用）
    await waitForIceGatheringComplete(this.pc, this.pendingIceRejects);
    // 必须在等待之后重读：candidate 在 gathering 过程中追加进 localDescription
    // SDP —— 若返回 beginOffer 的序列化快照则零 candidate（SG-4 实测回归：
    // Manual 配对通道永不 open；FakeRTC SDP 恒定故单测不可见）
    return this.encodeCurrentLocalDescription('createOffer');
  }

  async acceptOffer(encodedOffer: string): Promise<void> {
    this.assertAliveForSignaling('acceptOffer');
    await this.pc.setRemoteDescription(decodeSignaling(encodedOffer, 'offer'));
    this.remoteDescriptionApplied = true;
    await this.flushPendingRemoteCandidates();
  }

  async createAnswer(): Promise<string> {
    await this.beginAnswer();
    await waitForIceGatheringComplete(this.pc, this.pendingIceRejects);
    return this.encodeCurrentLocalDescription('createAnswer');
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

  /** 全量 gather 出口：等待后重读 localDescription（candidate 已并入 SDP） */
  private encodeCurrentLocalDescription(operation: string): string {
    const local = this.pc.localDescription;
    if (local === null) {
      throw new TransportError(
        'INVALID_SIGNALING',
        `[WebRTCTransport] ${operation}: local description missing after gathering`,
      );
    }
    return encodeDescription(local);
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
    this.lastLossReasonValue = reason; // SG-7：失败分类输入（超时路径不经过此处 = null）
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
