import type { NetworkManager } from './NetworkManager';
import type { PeerRole } from './PeerRole';
import { decodeSignaling } from './signaling/SignalingCodec';
import { SignalingClient, SignalingClientState, type SignalingFailure } from './signaling/SignalingClient';
import type { SignalingIceCandidate, SignalingInboundMessage } from './signaling/SignalingMessage';
import { TransportState } from './TransportState';
import type { WebRTCTransport } from './WebRTCTransport';

/**
 * RoomRecoveryController（SG-8）—— 对局期连接层恢复编排器：限次 ICE restart。
 *
 * 架构位置（与 RoomConnectionController 同层 —— 连接协议，零 NetworkEnvelope）：
 *
 *   BattleScene（UI 路由：disconnect → 恢复 or OPPONENT DISCONNECTED）
 *     → RoomRecoveryController（本类：限次重启编排 / 重信令 / PONG 验证）
 *       → SignalingClient（活信令 —— 房间存活 + peerToken，免玩家重输房间码）
 *       → WebRTCTransport（restartOffer / recoverConnect —— ICE restart）
 *
 * 恢复语义（迁移规格 SG-8）：
 * * 触发 = transport failed 系丢失（connectionState failed / persistent
 *   disconnect）；**Host 是唯一 restart 发起端**（offerer，与初始协商一致），
 *   Guest 被动应答 —— 角色由动作固化，双端同时发起会互踩。
 * * 限次（默认 3 次 × 20s 窗口 ≈ 60s 总预算）—— 手机后台短暂切走回来
 *   赶得上（后台期 ICE failed 事件可能未派发，visibilitychange 回前台时
 *   recheckConnection 补查）；耗尽 → Connection Lost（走既有断线 UX）。
 * * 信令死 → 新建 SignalingClient + joinRoom(roomCode, peerToken) 原位
 *   重入（SG-2 token resume；Host 超 grace 房间已删 → ROOM_NOT_FOUND
 *   快速失败 —— Host = 房间锚点语义）。
 * * PONG 验证成功 ≠ 状态一致 —— 对账一律走既有 Phase 15
 *   STATE_SYNC_REQUEST / STATE_SNAPSHOT 恢复链（场景层
 *   requestPostReconnectSync，本类不触碰 Gameplay State）。
 * * 红线：不 import NetworkEnvelope / GameCommand；Gameplay 对 Signaling
 *   零感知（恢复交换的 OFFER/ANSWER/ICE 帧与初始协商同构）。
 */

export enum RoomRecoveryState {
  IDLE = 'IDLE',
  RECONNECTING = 'RECONNECTING',
  RECOVERED = 'RECOVERED',
  FAILED = 'FAILED',
}

/** 值得 restart 的丢失原因（网络断族）；CHANNEL_CLOSED/PEER_CLOSED/ICE_CLOSED = 对端主动离场，立即终局 */
const RECOVERABLE_LOSS_REASONS: ReadonlySet<string> = new Set([
  'CONNECTION_FAILED',
  'ICE_FAILED',
  'CHANNEL_ERROR',
]);

export interface RoomRecoveryControllerOptions {
  readonly role: PeerRole;
  readonly transport: WebRTCTransport;
  readonly networkManager: NetworkManager;
  /** session.signaling —— 可能已死（恢复时按需重建） */
  readonly signaling: SignalingClient;
  readonly roomCode: string;
  readonly peerToken: string;
  /** 信令断后重建工厂（Scene 注入部署 URL；测试注入 fake WS 工厂） */
  readonly createSignalingClient: () => SignalingClient;
  /** 成功重入后移交会话生命周期；返回 false 表示会话已经退出。 */
  readonly adoptSignaling?: (client: SignalingClient) => boolean;
  /** 单次尝试窗口：restart 交换 + 通道恢复 + PONG 验证（默认 20s） */
  readonly attemptWindowMs?: number;
  /** 尝试上限（默认 3 —— 总预算 ≈ 60s） */
  readonly maxAttempts?: number;
  /** 通道恢复后的 PONG 验证窗口（默认 10s） */
  readonly verifyTimeoutMs?: number;
  /** 重建信令的 join ack 等待窗口（默认 8s） */
  readonly signalingJoinTimeoutMs?: number;
  /** 状态迁移通知（场景横幅 / Debug） */
  readonly onStateChange?: (state: RoomRecoveryState) => void;
}

const DEFAULT_ATTEMPT_WINDOW_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;
const DEFAULT_SIGNALING_JOIN_TIMEOUT_MS = 8_000;

export class RoomRecoveryController {
  private readonly options: RoomRecoveryControllerOptions;
  private readonly transport: WebRTCTransport;
  private readonly attemptWindowMs: number;
  private readonly maxAttempts: number;
  private readonly verifyTimeoutMs: number;
  private readonly signalingJoinTimeoutMs: number;

  private recoveryState: RoomRecoveryState = RoomRecoveryState.IDLE;
  private attemptCount = 0;
  private pendingAttempt: Promise<'RECOVERED' | 'FAILED'> | null = null;
  /** dispose 打断在途等待（Scene shutdown 不留悬挂尝试 / 悬挂 timer） */
  private readonly disposeWaiters = new Set<(error: Error) => void>();
  /** 当前可用信令（初始 = session.signaling；死后由重建实例替换） */
  private activeSignaling: SignalingClient;
  /** 尚未移交 SessionManager 的实例；失败 / dispose 时关闭。 */
  private readonly ownedSignaling = new Set<SignalingClient>();
  private readonly cancels: Array<() => void> = [];
  private readonly visibilityHandler = (): void => {
    // 移动端后台恢复：connectionstatechange 事件可能未派发 —— visible 时补查
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.transport.recheckConnection();
    }
  };
  private disposed = false;

  constructor(options: RoomRecoveryControllerOptions) {
    this.options = options;
    this.transport = options.transport;
    this.attemptWindowMs = options.attemptWindowMs ?? DEFAULT_ATTEMPT_WINDOW_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    this.signalingJoinTimeoutMs = options.signalingJoinTimeoutMs ?? DEFAULT_SIGNALING_JOIN_TIMEOUT_MS;
    this.activeSignaling = options.signaling;
    // 长驻被动接线（battle 全期）：Host 随时可能因自身网络故障发起 restart，
    // Guest 在自身尚未感知故障时就要能应答 restart OFFER
    this.wireSignaling(options.signaling);
    this.cancels.push(
      this.transport.onLocalIceCandidate((candidate) => {
        this.forwardLocalCandidate(candidate);
      }),
    );
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
      this.cancels.push(() => {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
      });
    }
  }

  get state(): RoomRecoveryState {
    return this.recoveryState;
  }

  /** 已消耗尝试次数（诊断 / Debug 句柄） */
  get currentAttemptCount(): number {
    return this.attemptCount;
  }

  /** 恢复是否可尝试：网络断族丢失原因 + 未在恢复中 + transport 可恢复态 */
  shouldAttempt(): boolean {
    if (this.pendingAttempt !== null) {
      return false;
    }
    const state = this.transport.state;
    if (state !== TransportState.FAILED && state !== TransportState.DISCONNECTED) {
      return false;
    }
    return RECOVERABLE_LOSS_REASONS.has(this.transport.lastLossReason ?? '');
  }

  /**
   * 限次恢复（幂等：in-flight 复用同一 promise）。
   * Host：每轮 restartOffer → OFFER 帧；Guest：被动等对端 OFFER 并应答。
   * 单轮：信令就绪（按需重建 + token 重入）→ recoverConnect 武装 →
   * Host 外发 restart offer → 等通道恢复 → PONG 验证。
   */
  attemptRecovery(): Promise<'RECOVERED' | 'FAILED'> {
    if (this.pendingAttempt !== null) {
      return this.pendingAttempt;
    }
    if (this.disposed) {
      return Promise.resolve('FAILED');
    }
    const promise = this.runRecovery().finally(() => {
      this.pendingAttempt = null;
    });
    this.pendingAttempt = promise;
    return promise;
  }

  /** 全清理（Scene shutdown）；transport / session 原信令归 SessionManager dispose 链 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // 打断在途等待 → pendingAttempt 立即收口 'FAILED'（Scene 侧有终局守卫）
    const error = new Error('[RoomRecovery] disposed');
    for (const waiter of [...this.disposeWaiters]) {
      waiter(error);
    }
    this.disposeWaiters.clear();
    for (const cancel of this.cancels) {
      cancel();
    }
    this.cancels.length = 0;
    for (const client of this.ownedSignaling) {
      client.close();
    }
    this.ownedSignaling.clear();
  }

  // ---- 恢复主循环 ---------------------------------------------------------

  private async runRecovery(): Promise<'RECOVERED' | 'FAILED'> {
    this.setRecoveryState(RoomRecoveryState.RECONNECTING);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.attemptCount = attempt;
      try {
        await this.runAttempt();
        await this.waitOrDisposed(this.verifyLiveness());
        this.setRecoveryState(RoomRecoveryState.RECOVERED);
        return 'RECOVERED';
      } catch (error) {
        if (this.disposed) {
          break; // dispose 打断：立即收口，不留悬挂尝试
        }
        console.warn(
          `[RoomRecovery] attempt ${attempt}/${this.maxAttempts} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    this.setRecoveryState(RoomRecoveryState.FAILED);
    return 'FAILED';
  }

  /** 等待期间可被 dispose 打断（rejected → 尝试链立即收口 FAILED） */
  private waitOrDisposed(promise: Promise<void>): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('[RoomRecovery] disposed'));
    }
    return new Promise<void>((resolve, reject) => {
      const onDispose = (): void => {
        reject(new Error('[RoomRecovery] disposed during wait'));
      };
      this.disposeWaiters.add(onDispose);
      promise.then(
        () => {
          this.disposeWaiters.delete(onDispose);
          resolve();
        },
        (error: unknown) => {
          this.disposeWaiters.delete(onDispose);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private async runAttempt(): Promise<void> {
    const signaling = await this.ensureSignalingReady();
    // recoverConnect 先行武装：FAILED → CONNECTING，后续 ICE failed 经
    // failConnect reject 本 promise（限次语义收口在本类）
    const connectPromise = this.transport.recoverConnect(this.attemptWindowMs);
    // OFFER 失败 / dispose 可能先退出；武装的连接等待仍须观察迟到 rejection。
    void connectPromise.catch(() => {});
    if (this.options.role === 'host') {
      await this.waitOrDisposed(this.sendRestartOffer(signaling));
    }
    // Guest 无本地动作：等对端 OFFER → handleRestartOffer 应答 → 通道恢复
    await this.waitOrDisposed(connectPromise);
  }

  /** Host：ICE restart offer 外发（trickle —— 新 candidate 随后经信令转发） */
  private async sendRestartOffer(signaling: SignalingClient): Promise<void> {
    if (this.disposed) {
      return;
    }
    const encoded = await this.transport.restartOffer();
    if (this.disposed) {
      return;
    }
    const sdp = decodeSignaling(encoded, 'offer').sdp;
    if (sdp === undefined) {
      throw new Error('restart offer SDP missing');
    }
    signaling.sendOffer(sdp);
  }

  /** 信令就绪：可用直接复用；死则重建 + token 原位重入（SG-2 resume） */
  private async ensureSignalingReady(): Promise<SignalingClient> {
    if (this.isSignalingUsable(this.activeSignaling)) {
      return this.activeSignaling;
    }
    const client = this.options.createSignalingClient();
    this.ownedSignaling.add(client);
    this.wireSignaling(client);
    try {
      await this.waitOrDisposed(client.connect());
      client.joinRoom(this.options.roomCode, this.options.peerToken);
      await this.waitForRoomAck(client);
      if (this.disposed) {
        throw new Error('[RoomRecovery] disposed before signaling adoption');
      }
      if (this.options.adoptSignaling !== undefined) {
        if (!this.options.adoptSignaling(client)) {
          throw new Error('[RoomRecovery] session no longer active');
        }
        this.ownedSignaling.delete(client);
      }
      this.activeSignaling = client;
      return client;
    } catch (error) {
      client.close();
      this.ownedSignaling.delete(client);
      throw error;
    }
  }

  /** battle 期可用态 = 房内（协商后常驻 NEGOTIATING；PEER_FOUND = 重入后） */
  private isSignalingUsable(client: SignalingClient): boolean {
    return (
      client.state === SignalingClientState.PEER_FOUND ||
      client.state === SignalingClientState.NEGOTIATING
    );
  }

  /** join ack 等待（ROOM_JOINED one-shot + 失败/超时双出口） */
  private waitForRoomAck(client: SignalingClient): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        cancel();
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const cancelMessage = client.onMessage((message) => {
        if (message.type === 'ROOM_JOINED') {
          settle();
        }
      });
      const cancelFailure = client.onFailure((failure: SignalingFailure) => {
        settle(
          new Error(`signaling rejoin failed: ${failure.code ?? failure.reason}`),
        );
      });
      const cancel = (): void => {
        cancelMessage();
        cancelFailure();
        this.disposeWaiters.delete(onDispose);
      };
      const onDispose = (): void => settle(new Error('[RoomRecovery] disposed during rejoin'));
      this.disposeWaiters.add(onDispose);
      const timer = setTimeout(() => {
        settle(new Error('signaling rejoin timeout: ROOM_JOINED not received'));
      }, this.signalingJoinTimeoutMs);
    });
  }

  /** 通道恢复后的存活性验证：PING → PONG（复用 NetworkManager PING/PONG） */
  private verifyLiveness(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        cancelPong();
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const cancelPong = this.options.networkManager.onPong(() => {
        settle();
      });
      const timer = setTimeout(() => {
        settle(new Error('recovery verify timeout: PONG not received'));
      }, this.verifyTimeoutMs);
      try {
        this.options.networkManager.ping();
      } catch (error) {
        settle(
          new Error(
            `recovery verify ping failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  // ---- 信令接线（每个采纳的 client 一份；帧处理随 client 走） ------------------

  private wireSignaling(client: SignalingClient): void {
    this.cancels.push(
      client.onMessage((message) => {
        this.handleSignalingMessage(message, client);
      }),
      client.onFailure((failure) => {
        // DataChannel 存活时信令断不自动恢复（WS_CLOSED 语义裁决归上层）；
        // 恢复期由 ensureSignalingReady 按需重建
        if (this.activeSignaling === client) {
          console.warn(`[RoomRecovery] signaling lost (${failure.reason}) — will rebuild on next attempt`);
        }
      }),
    );
  }

  private handleSignalingMessage(message: SignalingInboundMessage, client: SignalingClient): void {
    if (this.disposed) {
      return;
    }
    try {
      switch (message.type) {
        case 'OFFER':
          if (this.options.role === 'guest') {
            // battle 期任何 OFFER = restart offer（初始协商早已完成）；
            // 自身未感知故障也要应答 —— Host 单边故障场景
            void this.handleRestartOffer(message.sdp, client);
          }
          return;
        case 'ANSWER':
          if (this.options.role === 'host' && this.pendingAttempt !== null) {
            void this.handleRestartAnswer(message.sdp);
          }
          return;
        case 'ICE_CANDIDATE':
          this.transport.addIceCandidate(message.candidate);
          return;
        case 'ICE_END':
          console.debug('[RoomRecovery] remote ICE_END received');
          return;
        case 'PEER_JOINED':
          // 对端信令（重）入房：Host 恢复期 offer 可能曾被 relay 静默丢弃
          //（对端 socket 不在时）—— 立即重发一轮，免等本窗口超时
          if (this.options.role === 'host' && this.pendingAttempt !== null) {
            void this.sendRestartOffer(client).catch(() => {
              // 重发失败随本窗口超时收口
            });
          }
          return;
        case 'PEER_LEFT':
          // informational：对局期 DataChannel 是存活性权威（Phase 16 链处理）
          console.debug('[RoomRecovery] signaling PEER_LEFT received (informational)');
          return;
        default:
          return;
      }
    } catch (error) {
      // handler 异常不逃逸（同 NetworkManager 口径）；恢复正确性由窗口超时兜底
      console.error('[RoomRecovery] signaling handler threw:', error);
    }
  }

  /** Guest：应答 restart offer（acceptOffer → beginAnswer → sendAnswer） */
  private async handleRestartOffer(sdp: string, client: SignalingClient): Promise<void> {
    if (this.disposed || this.transport.state === TransportState.CLOSED) {
      return;
    }
    try {
      await this.transport.acceptOffer(JSON.stringify({ type: 'offer', sdp }));
      if (this.disposed) {
        return;
      }
      const encodedAnswer = await this.transport.beginAnswer();
      if (this.disposed) {
        return;
      }
      const answerSdp = decodeSignaling(encodedAnswer, 'answer').sdp;
      if (answerSdp === undefined) {
        throw new Error('restart answer SDP missing');
      }
      client.sendAnswer(answerSdp);
    } catch (error) {
      console.warn('[RoomRecovery] guest restart offer handling failed:', error);
    }
  }

  /** Host：应用 restart answer（acceptAnswer 后 ICE restart 生效，通道恢复由 recoverConnect 判定） */
  private async handleRestartAnswer(sdp: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      await this.transport.acceptAnswer(JSON.stringify({ type: 'answer', sdp }));
    } catch (error) {
      console.warn('[RoomRecovery] host restart answer handling failed:', error);
    }
  }

  /** Trickle：本地 candidate 经当前可用信令外发；信令不可用则丢弃（下轮 restartOffer 重新 gather） */
  private forwardLocalCandidate(candidate: SignalingIceCandidate | null): void {
    if (this.disposed) {
      return;
    }
    const signaling = this.activeSignaling;
    if (!this.isSignalingUsable(signaling)) {
      return;
    }
    try {
      if (candidate === null) {
        signaling.sendIceEnd();
        return;
      }
      signaling.sendIceCandidate(candidate);
    } catch (error) {
      console.debug('[RoomRecovery] local candidate forward dropped:', error);
    }
  }

  private setRecoveryState(next: RoomRecoveryState): void {
    this.recoveryState = next;
    try {
      this.options.onStateChange?.(next);
    } catch (error) {
      console.error('[RoomRecovery] onStateChange handler threw:', error);
    }
  }
}
