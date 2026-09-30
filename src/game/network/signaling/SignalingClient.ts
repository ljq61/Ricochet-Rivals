import {
  decodeSignalingMessage,
  encodeSignalingMessage,
  type SignalingIceCandidate,
  type SignalingInboundMessage,
  type SignalingOutboundMessage,
} from './SignalingMessage';
import { isValidRoomCode, normalizeRoomCode } from './RoomCode';

/**
 * SignalingClient（Online Connection Migration SG-1）—— Signaling
 * WebSocket 客户端 + 连接层状态机。
 *
 * 架构位置（迁移规格）：
 *
 *   OnlineConnectionScene → RoomConnectionController（SG-3）
 *     → SignalingClient（本类：WS 连接 / 房间信令 / 协商帧转发）
 *     → WebRTCTransport（DataChannel，Gameplay 通道）
 *
 * * 只搬运 SignalingMessage（连接协议）；不 import NetworkEnvelope，
 *   不触碰 GameCommand / GameState —— Gameplay 对 Signaling Server
 *   零感知。
 * * 状态机（规格推荐 7 态）：
 *   DISCONNECTED → CONNECTING → CONNECTED
 *     Host：CREATE_ROOM → ROOM_CREATED → ROOM_WAITING → PEER_JOINED
 *     Guest：JOIN_ROOM → ROOM_JOINED → PEER_FOUND
 *     双方：首个协商帧（OFFER/ANSWER/ICE_CANDIDATE/ICE_END）→ NEGOTIATING
 *   FAILED = 连接层终局（ERROR 消息 / WS 中断 / 超时）；PEER_LEFT 只
 *   投递事件不改状态 —— 协商期离开由 controller 裁决为连接失败，对局
 *   期 DataChannel 已立、Phase 16 断线链处理，本层不越权。
 * * 出站 send API 全部同步 throw SignalingError（防御误用，同
 *   WebRTCTransport send 的不静默口径）；入站畸形帧记录丢弃不崩。
 * * close() 全清理 + 幂等（摘 listener → 结清 pending → 关 socket →
 *   清订阅）；FAILED / close 后本实例不可复活 —— 重连一律新建实例
 *   （同 NetworkManager.disconnect 注释的 transport 纪律）。SG-8 的
 *   ICE restart 需要重新信令时也走新实例 + peerToken 重入（SG-2 定义）。
 * * handler 兜底：单个订阅者抛错只 console.error，不阻断其余订阅者
 *   与后续帧（同 NetworkManager）。
 */

export enum SignalingClientState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ROOM_WAITING = 'ROOM_WAITING',
  PEER_FOUND = 'PEER_FOUND',
  NEGOTIATING = 'NEGOTIATING',
  FAILED = 'FAILED',
}

/** SignalingClient API 误用错误（同步 throw；技术细节不进正式 UI） */
export type SignalingErrorReason =
  /** socket 未打开（未连接 / 已断）—— send / 房间操作拒绝 */
  | 'NOT_CONNECTED'
  /** 房间内无对端 —— 协商帧发送拒绝 */
  | 'NO_PEER'
  /** 当前状态不接受该操作（如已入房后重复 createRoom） */
  | 'INVALID_STATE'
  /** JOIN 输入不是合法 6 位房间码 */
  | 'INVALID_ROOM_CODE'
  /** close() 后 / FAILED 后实例已死 —— 重连需新建实例 */
  | 'TERMINAL'
  /** connect() 失败（WS error / 超时 / 握手期中断） */
  | 'CONNECT_FAILED';

export class SignalingError extends Error {
  readonly reason: SignalingErrorReason;

  constructor(reason: SignalingErrorReason, message: string) {
    super(message);
    this.name = 'SignalingError';
    this.reason = reason;
  }
}

/** 连接层失败分类（SG-7 失败 UX 的原始输入；正式文案由 controller 映射） */
export type SignalingFailureReason =
  /** 握手期 WS error / 工厂失败 / 中断 */
  | 'CONNECT_FAILED'
  /** WS open 超时 */
  | 'CONNECT_TIMEOUT'
  /** 建立后的 WS 关闭（信令断；对局中 DataChannel 可能仍活，由上层裁决） */
  | 'WS_CLOSED'
  /** Server ERROR 消息（code 携带具体原因） */
  | 'SERVER_ERROR';

export interface SignalingFailure {
  readonly reason: SignalingFailureReason;
  readonly code?: string;
  readonly detail?: string;
}

export interface SignalingClientOptions {
  /** Signaling Server WebSocket 地址（wss:// 生产 / ws:// 本地调试） */
  readonly url: string;
  /** 测试注入 fake；缺省用浏览器原生 WebSocket */
  readonly webSocketFactory?: (url: string) => WebSocket;
  /** WS open 预算（默认 10s —— 信令服务器应当近在咫尺） */
  readonly connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

function defaultWebSocketFactory(url: string): WebSocket {
  return new WebSocket(url);
}

/** socket 已建立的存活态（connect() 直接 resolve / send 可用前提） */
function isSocketLiveState(state: SignalingClientState): boolean {
  return (
    state === SignalingClientState.CONNECTED ||
    state === SignalingClientState.ROOM_WAITING ||
    state === SignalingClientState.PEER_FOUND ||
    state === SignalingClientState.NEGOTIATING
  );
}

/** 房间内已有对端（协商帧可发送的前提） */
function hasPeerState(state: SignalingClientState): boolean {
  return state === SignalingClientState.PEER_FOUND || state === SignalingClientState.NEGOTIATING;
}

export class SignalingClient {
  private readonly url: string;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly connectTimeoutMs: number;

  private clientState: SignalingClientState = SignalingClientState.DISCONNECTED;
  private ws: WebSocket | null = null;
  /** open 事件已到且未断 —— send 的运行时前提（不依赖 WebSocket 常量） */
  private socketOpen = false;
  /** close() 已调用 —— 终态，本实例不可复活（重连新建实例） */
  private closed = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: SignalingError) => void) | null = null;
  private connectPromise: Promise<void> | null = null;
  private failure: SignalingFailure | null = null;

  private readonly stateChangeHandlers = new Set<(state: SignalingClientState) => void>();
  private readonly messageHandlers = new Set<(message: SignalingInboundMessage) => void>();
  private readonly failureHandlers = new Set<(failure: SignalingFailure) => void>();

  constructor(options: SignalingClientOptions) {
    this.url = options.url;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  get state(): SignalingClientState {
    return this.clientState;
  }

  /** 最近一次失败详情（FAILED 后保留 —— SG-7 失败分类的原始输入） */
  get lastFailure(): SignalingFailure | null {
    return this.failure;
  }

  // ---- 订阅（handler 异常不逃逸） ------------------------------------------

  onStateChange(handler: (state: SignalingClientState) => void): () => void {
    this.stateChangeHandlers.add(handler);
    return () => {
      this.stateChangeHandlers.delete(handler);
    };
  }

  /** 全部入站信令消息（解码后、状态迁移后投递；ERROR 除外 —— 见 applyInbound） */
  onMessage(handler: (message: SignalingInboundMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /** FAILED 进入时触发一次（携带失败分类；onStateChange 收到 FAILED） */
  onFailure(handler: (failure: SignalingFailure) => void): () => void {
    this.failureHandlers.add(handler);
    return () => {
      this.failureHandlers.delete(handler);
    };
  }

  // ---- 连接 ------------------------------------------------------------------

  /** 拨号：存活态直接 resolve；CONNECTING 复用同一 promise；
   *  DISCONNECTED 重新拨号；FAILED / close 后 reject（重连需新建实例）。 */
  connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new SignalingError('TERMINAL', '[SignalingClient] connect rejected: client closed'),
      );
    }
    if (isSocketLiveState(this.clientState)) {
      return Promise.resolve();
    }
    if (this.clientState === SignalingClientState.FAILED) {
      return Promise.reject(
        new SignalingError(
          'TERMINAL',
          '[SignalingClient] connect rejected: client failed — reconnect requires a new client',
        ),
      );
    }
    if (this.clientState === SignalingClientState.CONNECTING) {
      if (this.connectPromise === null) {
        throw new Error('[SignalingClient] internal invariant: CONNECTING without pending promise');
      }
      return this.connectPromise;
    }
    return this.beginDial();
  }

  private beginDial(): Promise<void> {
    this.setState(SignalingClientState.CONNECTING);
    // pending promise 先于 factory 建立：factory 抛错也要有 reject 出口
    const promise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    this.connectPromise = promise;
    let ws: WebSocket;
    try {
      ws = this.webSocketFactory(this.url);
    } catch (error) {
      this.fail({
        reason: 'CONNECT_FAILED',
        detail: `factory threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      return promise;
    }
    this.ws = ws;
    ws.addEventListener('open', this.handleOpen);
    ws.addEventListener('message', this.handleSocketMessage);
    ws.addEventListener('error', this.handleSocketError);
    ws.addEventListener('close', this.handleSocketClose);
    this.connectTimer = setTimeout(() => {
      this.fail({ reason: 'CONNECT_TIMEOUT' });
    }, this.connectTimeoutMs);
    return promise;
  }

  // ---- 房间操作 -----------------------------------------------------------

  /** Host：创建房间（Server 生成 roomCode/peerToken/iceServers 回 ROOM_CREATED） */
  createRoom(): void {
    this.requireSocketOpen('createRoom');
    if (this.clientState !== SignalingClientState.CONNECTED) {
      throw new SignalingError(
        'INVALID_STATE',
        `[SignalingClient] createRoom requires CONNECTED (current: ${this.clientState})`,
      );
    }
    this.sendFrame({ type: 'CREATE_ROOM' });
  }

  /** Guest：加入房间（输入经 normalize；非法码拒绝于本端，零帧发出）。
   *  peerToken（可选）：重连身份 —— 上次会话的 token，Server 在 grace 窗口内
   *  原位恢复（SG-2 reconnect identity / SG-8 ICE restart 重信令）。 */
  joinRoom(roomCode: string, peerToken?: string): void {
    this.requireSocketOpen('joinRoom');
    if (this.clientState !== SignalingClientState.CONNECTED) {
      throw new SignalingError(
        'INVALID_STATE',
        `[SignalingClient] joinRoom requires CONNECTED (current: ${this.clientState})`,
      );
    }
    const normalized = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(normalized)) {
      throw new SignalingError(
        'INVALID_ROOM_CODE',
        `[SignalingClient] room code rejected: '${roomCode}' → '${normalized}'`,
      );
    }
    this.sendFrame({ type: 'JOIN_ROOM', roomCode: normalized, peerToken });
  }

  // ---- 协商帧转发（Trickle ICE；SG-3 RoomConnectionController 消费） -------

  sendOffer(sdp: string): void {
    this.requirePeer('sendOffer');
    this.sendFrame({ type: 'OFFER', sdp });
    this.markNegotiating();
  }

  sendAnswer(sdp: string): void {
    this.requirePeer('sendAnswer');
    this.sendFrame({ type: 'ANSWER', sdp });
    this.markNegotiating();
  }

  sendIceCandidate(candidate: SignalingIceCandidate): void {
    this.requirePeer('sendIceCandidate');
    this.sendFrame({ type: 'ICE_CANDIDATE', candidate });
    this.markNegotiating();
  }

  /** 本端 gathering 完结（onicecandidate null 信号）—— 对端停止等待 */
  sendIceEnd(): void {
    this.requirePeer('sendIceEnd');
    this.sendFrame({ type: 'ICE_END' });
    this.markNegotiating();
  }

  // ---- 生命周期 -------------------------------------------------------------

  /** 主动关闭：全清理 + 幂等（重入 Online / 退菜单后旧信令断不可复活） */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearConnectTimer();
    const reject = this.connectReject;
    this.clearConnectPending();
    const ws = this.ws;
    this.detachSocket();
    this.ws = null;
    this.socketOpen = false;
    // listener 已摘 —— 底层 close 不触发 spurious 回调
    ws?.close();
    reject?.(new SignalingError('TERMINAL', '[SignalingClient] closed while connecting'));
    this.setState(SignalingClientState.DISCONNECTED);
    this.stateChangeHandlers.clear();
    this.messageHandlers.clear();
    this.failureHandlers.clear();
  }

  // ---- DOM 事件（close / fail 时按引用摘除） ------------------------------

  private readonly handleOpen = (): void => {
    this.clearConnectTimer();
    this.socketOpen = true;
    const resolve = this.connectResolve;
    this.clearConnectPending();
    this.setState(SignalingClientState.CONNECTED);
    resolve?.();
  };

  private readonly handleSocketMessage = (event: MessageEvent): void => {
    const data = event.data;
    if (typeof data !== 'string') {
      console.warn('[SignalingClient] dropped non-text websocket frame');
      return;
    }
    const result = decodeSignalingMessage(data);
    if (!result.ok) {
      console.warn(
        `[SignalingClient] dropped malformed signaling frame (${result.reason}${result.detail !== undefined ? `:${result.detail}` : ''})`,
      );
      return;
    }
    this.applyInbound(result.message);
  };

  private readonly handleSocketError = (): void => {
    this.socketDeath('websocket error event');
  };

  private readonly handleSocketClose = (): void => {
    this.socketDeath('websocket closed');
  };

  // ---- 内部 -----------------------------------------------------------------

  /** WS 中断分类：握手期（pending 未结）→ CONNECT_FAILED；建立后 → WS_CLOSED */
  private socketDeath(detail: string): void {
    if (this.connectPromise !== null) {
      this.fail({ reason: 'CONNECT_FAILED', detail });
    } else {
      this.fail({ reason: 'WS_CLOSED', detail });
    }
  }

  /** 入站分发：状态迁移 → 投递订阅者；ERROR 是 FAILED 事件（onFailure 承载，不投 onMessage） */
  private applyInbound(message: SignalingInboundMessage): void {
    switch (message.type) {
      case 'ROOM_CREATED':
        if (this.clientState === SignalingClientState.CONNECTED) {
          this.setState(SignalingClientState.ROOM_WAITING);
        } else {
          console.warn(`[SignalingClient] ROOM_CREATED ignored (state: ${this.clientState})`);
        }
        break;
      case 'ROOM_JOINED':
        // Guest 语义：房主已在房内 → 对端即时在场（无需 ROOM_WAITING）
        if (this.clientState === SignalingClientState.CONNECTED) {
          this.setState(SignalingClientState.PEER_FOUND);
        } else {
          console.warn(`[SignalingClient] ROOM_JOINED ignored (state: ${this.clientState})`);
        }
        break;
      case 'PEER_JOINED':
        if (this.clientState === SignalingClientState.ROOM_WAITING) {
          this.setState(SignalingClientState.PEER_FOUND);
        } else if (this.clientState !== SignalingClientState.PEER_FOUND && this.clientState !== SignalingClientState.NEGOTIATING) {
          console.warn(`[SignalingClient] PEER_JOINED ignored (state: ${this.clientState})`);
        }
        break;
      case 'OFFER':
      case 'ANSWER':
      case 'ICE_CANDIDATE':
      case 'ICE_END':
        // Trickle：首个协商帧即进入 NEGOTIATING；已在其中则 no-op；
        // 非法状态下仍投递（controller 诊断，本层不越权销毁）
        if (this.clientState === SignalingClientState.PEER_FOUND) {
          this.setState(SignalingClientState.NEGOTIATING);
        }
        break;
      case 'PEER_LEFT':
        // 状态不变：协商期 = controller 裁决连接失败；对局期 DataChannel
        // 已立、Phase 16 断线链处理 —— 本层不越权
        break;
      case 'ERROR':
        this.fail({ reason: 'SERVER_ERROR', code: message.code, detail: message.message });
        return;
    }
    for (const handler of [...this.messageHandlers]) {
      try {
        handler(message);
      } catch (error) {
        console.error('[SignalingClient] onMessage handler threw:', error);
      }
    }
  }

  private sendFrame(message: SignalingOutboundMessage): void {
    const wire = encodeSignalingMessage(message); // 内部契约违规原样抛（本类 bug）
    const ws = this.ws;
    if (ws === null || !this.socketOpen) {
      throw new SignalingError('NOT_CONNECTED', '[SignalingClient] send rejected: socket not open');
    }
    try {
      ws.send(wire);
    } catch (error) {
      throw new SignalingError(
        'NOT_CONNECTED',
        `[SignalingClient] websocket send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private requireSocketOpen(operation: string): void {
    if (this.closed) {
      throw new SignalingError('TERMINAL', `[SignalingClient] ${operation} rejected: client closed`);
    }
    if (this.ws === null || !this.socketOpen) {
      throw new SignalingError(
        'NOT_CONNECTED',
        `[SignalingClient] ${operation} rejected: socket is ${this.clientState}`,
      );
    }
  }

  private requirePeer(operation: string): void {
    this.requireSocketOpen(operation);
    if (!hasPeerState(this.clientState)) {
      throw new SignalingError(
        'NO_PEER',
        `[SignalingClient] ${operation} rejected: no peer in room (state: ${this.clientState})`,
      );
    }
  }

  private markNegotiating(): void {
    if (this.clientState === SignalingClientState.PEER_FOUND) {
      this.setState(SignalingClientState.NEGOTIATING);
    }
  }

  /** 连接层失败收口：清 pending → 摘 listener → FAILED → 通知（幂等） */
  private fail(failure: SignalingFailure): void {
    if (this.closed || this.clientState === SignalingClientState.FAILED) {
      return;
    }
    this.clearConnectTimer();
    const reject = this.connectReject;
    this.clearConnectPending();
    const ws = this.ws;
    this.detachSocket();
    this.ws = null;
    this.socketOpen = false;
    ws?.close();
    this.failure = failure;
    this.setState(SignalingClientState.FAILED);
    for (const handler of [...this.failureHandlers]) {
      try {
        handler(failure);
      } catch (error) {
        console.error('[SignalingClient] onFailure handler threw:', error);
      }
    }
    reject?.(
      new SignalingError(
        'CONNECT_FAILED',
        `[SignalingClient] ${failure.reason}${failure.code !== undefined ? ` (${failure.code})` : ''}${failure.detail !== undefined ? `: ${failure.detail}` : ''}`,
      ),
    );
  }

  private detachSocket(): void {
    const ws = this.ws;
    if (ws === null) {
      return;
    }
    ws.removeEventListener('open', this.handleOpen);
    ws.removeEventListener('message', this.handleSocketMessage);
    ws.removeEventListener('error', this.handleSocketError);
    ws.removeEventListener('close', this.handleSocketClose);
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

  private setState(next: SignalingClientState): boolean {
    if (this.clientState === next) {
      return false;
    }
    this.clientState = next;
    for (const handler of [...this.stateChangeHandlers]) {
      try {
        handler(next);
      } catch (error) {
        console.error('[SignalingClient] onStateChange handler threw:', error);
      }
    }
    return true;
  }
}
