import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkManager } from '../../src/game/network/NetworkManager';
import { OnlineSessionManager, type OnlineSession } from '../../src/game/network/OnlineSession';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import {
  RoomRecoveryController,
  RoomRecoveryState,
  type RoomRecoveryControllerOptions,
} from '../../src/game/network/RoomRecoveryController';
import { SignalingClient } from '../../src/game/network/signaling/SignalingClient';
import { WebRTCTransport } from '../../src/game/network/WebRTCTransport';
import { serializeEnvelope } from '../../src/game/network/serialization/NetworkSerializer';
import { makeEnvelope } from './envelopeFixture';
import { FakeWebSocket, frame } from './signaling/fakeWebSocket';
import {
  FakeRTCDataChannel,
  FakeRTCPeerConnection,
  tick,
} from './webrtcFakes';

/**
 * RoomRecoveryController（SG-8）—— 对局期限次 ICE restart 恢复全矩阵。
 * 双 fake 驱动：FakeWebSocket（信令侧，测试扮演 Signaling Server 推送
 * ROOM ack / PEER_JOINED / OFFER / ANSWER）+ FakeRTCPeerConnection
 * （DataChannel 侧，failConnection/restoreConnection 模拟网络断/恢复）。
 */

const ROOM_CODE = 'K7M4Q2';
const MATCH_ID = `online-room-${ROOM_CODE}`;
const ICE_SERVERS = [{ urls: 'stun:stun.unit-test:3478' }];

interface RecoveryHarness {
  readonly controller: RoomRecoveryController;
  readonly transport: WebRTCTransport;
  readonly pc: FakeRTCPeerConnection;
  readonly channel: FakeRTCDataChannel;
  readonly nm: NetworkManager;
  readonly sessionWs: FakeWebSocket;
  readonly sessionClient: SignalingClient;
  readonly rebuildWss: FakeWebSocket[];
  readonly states: RoomRecoveryState[];
}

function makeHarness(
  role: 'host' | 'guest',
  options?: Partial<Pick<RoomRecoveryControllerOptions, 'attemptWindowMs' | 'maxAttempts' | 'verifyTimeoutMs' | 'signalingJoinTimeoutMs' | 'adoptSignaling'>>,
): RecoveryHarness {
  const sessionWs = new FakeWebSocket();
  const sessionClient = new SignalingClient({
    url: 'ws://127.0.0.1:8787/signaling',
    webSocketFactory: () => sessionWs as unknown as WebSocket,
  });
  const pc = new FakeRTCPeerConnection();
  const transport = new WebRTCTransport({
    role,
    peerConnectionFactory: () => pc as unknown as RTCPeerConnection,
    pcCloseDelayMs: 0,
  });
  const nm = new NetworkManager({
    transport,
    matchId: MATCH_ID,
    localPlayerId: role === 'host' ? 'P1' : 'P2',
  });
  const rebuildWss: FakeWebSocket[] = [];
  const states: RoomRecoveryState[] = [];
  const controller = new RoomRecoveryController({
    role,
    transport,
    networkManager: nm,
    signaling: sessionClient,
    roomCode: ROOM_CODE,
    peerToken: role === 'host' ? 'host-token' : 'guest-token',
    createSignalingClient: () => {
      const ws = new FakeWebSocket();
      rebuildWss.push(ws);
      return new SignalingClient({
        url: 'ws://rebuild/signaling',
        webSocketFactory: () => ws as unknown as WebSocket,
      });
    },
    onStateChange: (state) => states.push(state),
    ...options,
  });
  return {
    controller,
    transport,
    pc,
    nm,
    sessionWs,
    sessionClient,
    rebuildWss,
    states,
    get channel(): FakeRTCDataChannel {
      const channel = pc.dataChannels[0];
      if (channel === undefined) {
        throw new Error('channel missing — establishBattle 未执行（Guest 通道经 setRemoteDescription 诞生）');
      }
      return channel;
    },
  };
}

/** 建立对局期前置态：DataChannel CONNECTED + 信令房内（PEER_FOUND） */
async function establishBattle(h: RecoveryHarness, role: 'host' | 'guest'): Promise<void> {
  if (role === 'guest') {
    // spawn Guest 侧 DataChannel（transport 经 datachannel 事件接第一条）
    await h.pc.setRemoteDescription({ type: 'offer', sdp: 'fake:offer-sdp' });
  }
  const channel = h.pc.dataChannels[0];
  if (channel === undefined) {
    throw new Error('channel missing');
  }
  const pending = h.transport.connect();
  channel.simulateOpen();
  await pending;

  // 信令入房（Host: CREATE → ack + PEER_JOINED；Guest: JOIN → ack）
  void h.sessionClient.connect();
  h.sessionWs.simulateOpen();
  await tick();
  if (role === 'host') {
    h.sessionClient.createRoom();
    h.sessionWs.serverSend(roomAckFrame('ROOM_CREATED'));
    h.sessionWs.serverSend(frame({ type: 'PEER_JOINED' }));
  } else {
    h.sessionClient.joinRoom(ROOM_CODE);
    h.sessionWs.serverSend(roomAckFrame('ROOM_JOINED'));
  }
  await tick();
}

function roomAckFrame(type: 'ROOM_CREATED' | 'ROOM_JOINED'): string {
  return frame({
    type,
    roomCode: ROOM_CODE,
    peerToken: type === 'ROOM_CREATED' ? 'host-token' : 'guest-token',
    iceServers: ICE_SERVERS,
    expiresAt: 1_800_000_000_000,
  });
}

/** 模拟对端回 PONG（找最近一条 PING 原样回 sentAt） */
function deliverPong(h: RecoveryHarness, senderId: 'P1' | 'P2'): void {
  const ping = [...h.channel.sent].reverse().find((raw) => raw.includes(`"${NetworkMessageType.PING}"`));
  if (ping === undefined) {
    throw new Error('no PING in channel.sent — verifyLiveness 未执行');
  }
  const sentAt = (JSON.parse(ping) as { payload: { sentAt: number } }).payload.sentAt;
  h.channel.emit('message', {
    data: serializeEnvelope(
      makeEnvelope({
        type: NetworkMessageType.PONG,
        matchId: MATCH_ID,
        turnId: 0,
        senderId,
        payload: { sentAt },
      }),
    ),
  });
}

function sentTypes(ws: FakeWebSocket): string[] {
  return ws.sentFrames().map((f) => String(f['type']));
}

/**
 * node 测试环境无 document —— 替身只覆盖控制器用到的最小面
 * （visibilityState / addEventListener / removeEventListener）。
 */
function stubDocument(): { emit: (type: string) => void; listenerCount: (type: string) => number } {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
  });
  return {
    emit: (type: string) => {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener({});
      }
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RoomRecoveryController（SG-8 限次 ICE restart）', () => {
  it('1. Host 恢复全流：FAILED → restartOffer(iceRestart) → OFFER 帧 → ANSWER → connected → PONG 验证 → RECOVERED', async () => {
    const h = makeHarness('host');
    await establishBattle(h, 'host');
    expect(h.transport.connected).toBe(true);

    h.pc.failConnection(); // FAILED + lastLossReason=CONNECTION_FAILED
    expect(h.controller.shouldAttempt()).toBe(true);

    const pending = h.controller.attemptRecovery();
    await tick(); // restartOffer + OFFER 外发 + recoverConnect 武装

    // OFFER 帧带 restart SDP；createOffer 收到 iceRestart:true
    expect(h.pc.createOfferOptions[0]).toEqual({ iceRestart: true });
    const offerFrame = h.sessionWs.sentFrames().find((f) => f['type'] === 'OFFER');
    expect(offerFrame).toMatchObject({ type: 'OFFER', sdp: 'fake:offer-sdp-restart' });

    // Trickle：restart 后本地 candidate 经活信令外发，null → ICE_END
    h.pc.emitLocalCandidate({ candidate: 'candidate:9 1 UDP 1 10.0.0.9 50000 typ host', sdpMid: '0' });
    await tick();
    expect(h.sessionWs.sentFrames().filter((f) => f['type'] === 'ICE_CANDIDATE').length).toBe(1);
    h.pc.completeIceGathering(); // null candidate → ICE_END
    await tick();
    expect(h.sessionWs.sentFrames().filter((f) => f['type'] === 'ICE_END').length).toBe(1);

    // 对端 ANSWER → acceptAnswer → 连接重建（connected + 通道存续 open）
    h.sessionWs.serverSend(frame({ type: 'ANSWER', sdp: 'fake:answer-sdp' }));
    await tick();
    h.pc.restoreConnection();
    await tick();
    expect(h.transport.connected).toBe(true);

    deliverPong(h, 'P2');
    await expect(pending).resolves.toBe('RECOVERED');
    expect(h.controller.state).toBe(RoomRecoveryState.RECOVERED);
    expect(h.states).toEqual([RoomRecoveryState.RECONNECTING, RoomRecoveryState.RECOVERED]);
  });

  it('2. Guest 恢复全流：被动等 OFFER → acceptOffer + beginAnswer → ANSWER 外发 → connected → PONG → RECOVERED（零 restartOffer）', async () => {
    const h = makeHarness('guest');
    await establishBattle(h, 'guest');

    h.pc.failConnection();
    expect(h.controller.shouldAttempt()).toBe(true);

    const pending = h.controller.attemptRecovery();
    await tick(); // Guest 无本地动作：只武装 recoverConnect 等待

    // Host 侧发来 restart OFFER（Guest 自身可能尚未感知故障也要应答）
    h.sessionWs.serverSend(frame({ type: 'OFFER', sdp: 'fake:offer-sdp-restart' }));
    await tick();
    const answerFrame = h.sessionWs.sentFrames().find((f) => f['type'] === 'ANSWER');
    expect(answerFrame).toMatchObject({ type: 'ANSWER', sdp: 'fake:answer-sdp' });

    h.pc.restoreConnection();
    await tick();
    deliverPong(h, 'P1');
    await expect(pending).resolves.toBe('RECOVERED');
    // Guest 永不发起 restart offer（角色由动作固化：Host = 唯一 offerer）
    expect(h.pc.createOfferOptions.length).toBe(0);
  });

  it('3. 限次重试：连接不恢复 → 每轮重新 restartOffer → 耗尽 FAILED', async () => {
    const h = makeHarness('host', { attemptWindowMs: 15, maxAttempts: 2, verifyTimeoutMs: 15 });
    await establishBattle(h, 'host');
    h.pc.failConnection();

    const pending = h.controller.attemptRecovery();
    await expect(pending).resolves.toBe('FAILED');
    expect(h.controller.state).toBe(RoomRecoveryState.FAILED);
    expect(h.controller.currentAttemptCount).toBe(2);
    expect(h.sessionWs.sentFrames().filter((f) => f['type'] === 'OFFER').length).toBe(2);
  });

  it('4. 重信令：session 信令已死 → 新 client 拨号 + JOIN_ROOM(peerToken) → ROOM_JOINED ack → 恢复继续（candidate 走新信令）', async () => {
    const h = makeHarness('host');
    await establishBattle(h, 'host');
    h.sessionWs.serverClose(); // WS 断 → session client FAILED
    h.pc.failConnection();

    const pending = h.controller.attemptRecovery();
    await tick(); // ensureSignalingReady 发现不可用 → 新建 client 开始拨号
    const ws2 = h.rebuildWss[0];
    if (ws2 === undefined) {
      throw new Error('rebuild signaling client missing');
    }
    ws2.simulateOpen();
    await tick();
    // JOIN_ROOM 携带 peerToken 原位重入（SG-2 resume）
    const joinFrame = ws2.sentFrames().find((f) => f['type'] === 'JOIN_ROOM');
    expect(joinFrame).toMatchObject({ type: 'JOIN_ROOM', roomCode: ROOM_CODE, peerToken: 'host-token' });
    ws2.serverSend(roomAckFrame('ROOM_JOINED'));
    await tick(); // ack → activeSignaling 替换 → restartOffer → OFFER
    expect(ws2.sentFrames().filter((f) => f['type'] === 'OFFER').length).toBe(1);

    // restart candidate 走新信令；死信令零新增帧（NOT_CONNECTED 在 client 侧即抛，不触 ws）
    h.pc.emitLocalCandidate({ candidate: 'candidate:3 1 UDP 1 10.0.0.3 50001 typ host', sdpMid: '0' });
    await tick();
    expect(ws2.sentFrames().filter((f) => f['type'] === 'ICE_CANDIDATE').length).toBe(1);
    expect(sentTypes(h.sessionWs)).not.toContain('ICE_CANDIDATE');

    ws2.serverSend(frame({ type: 'ANSWER', sdp: 'fake:answer-sdp' }));
    await tick();
    h.pc.restoreConnection();
    await tick();
    deliverPong(h, 'P2');
    await expect(pending).resolves.toBe('RECOVERED');
  });

  it('5. 重信令失败：ROOM_NOT_FOUND → 每轮新建 client 重试 → 耗尽 FAILED', async () => {
    const h = makeHarness('host', { maxAttempts: 2 });
    await establishBattle(h, 'host');
    h.sessionWs.serverClose();
    h.pc.failConnection();

    const pending = h.controller.attemptRecovery();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ws = h.rebuildWss[attempt];
      if (ws === undefined) {
        throw new Error(`rebuild signaling client #${attempt} missing`);
      }
      ws.simulateOpen();
      await tick();
      ws.serverSend(frame({ type: 'ERROR', code: 'ROOM_NOT_FOUND', message: 'room gone' }));
      await tick(); // join 失败 → 本轮 attempt 失败 → 下一轮
    }
    await expect(pending).resolves.toBe('FAILED');
    expect(h.rebuildWss.length).toBe(2);
    expect(h.rebuildWss.every((ws) => ws.readyState === 3)).toBe(true);
  });

  it('6. shouldAttempt 分类：网络断族可恢复；对端主动离场（CHANNEL_CLOSED/PEER_CLOSED/ICE_CLOSED）不进入恢复', async () => {
    const h = makeHarness('host');
    await establishBattle(h, 'host');

    // 健康态：无丢失不可恢复
    expect(h.controller.shouldAttempt()).toBe(false);

    h.pc.failConnection(); // CONNECTION_FAILED
    expect(h.controller.shouldAttempt()).toBe(true);

    h.transport.debugSimulateConnectionLost('ICE_FAILED');
    expect(h.controller.shouldAttempt()).toBe(true);

    h.transport.debugSimulateConnectionLost('CHANNEL_ERROR');
    expect(h.controller.shouldAttempt()).toBe(true);

    // CHANNEL_CLOSED：对端主动关 DataChannel（真实离场语义）
    h.channel.emit('error'); // 先回到可失败态（CHANNEL_ERROR → FAILED）
    h.channel.close();
    expect(h.controller.shouldAttempt()).toBe(false);

    // PEER_CLOSED：failed 粘滞下 pc closed 事件仍刷新 lastLossReason
    h.pc.failConnection();
    h.pc.close();
    expect(h.controller.shouldAttempt()).toBe(false);

    // ICE_CLOSED
    h.pc.failConnection();
    h.pc.iceConnectionState = 'closed';
    h.pc.emit('iceconnectionstatechange');
    expect(h.controller.shouldAttempt()).toBe(false);
  });

  it('7. PEER_JOINED 恢复期重发 restart offer（offer 曾被 relay 静默丢弃的场景）', async () => {
    const h = makeHarness('host');
    await establishBattle(h, 'host');
    h.pc.failConnection();

    const pending = h.controller.attemptRecovery();
    await tick();
    expect(h.sessionWs.sentFrames().filter((f) => f['type'] === 'OFFER').length).toBe(1);

    // 对端重入信令 → 立即补发一轮，免等本窗口超时
    h.sessionWs.serverSend(frame({ type: 'PEER_JOINED' }));
    await tick();
    expect(h.sessionWs.sentFrames().filter((f) => f['type'] === 'OFFER').length).toBe(2);

    // 收尾驱动到 RECOVERED（不留悬挂尝试）
    h.sessionWs.serverSend(frame({ type: 'ANSWER', sdp: 'fake:answer-sdp' }));
    await tick();
    h.pc.restoreConnection();
    await tick();
    deliverPong(h, 'P2');
    await expect(pending).resolves.toBe('RECOVERED');
  });

  it('8. visibilitychange visible → recheckConnection 补查（后台期 missed 事件）', async () => {
    const doc = stubDocument();
    const h = makeHarness('host');
    await establishBattle(h, 'host');
    expect(doc.listenerCount('visibilitychange')).toBe(1);
    const losses: string[] = [];
    h.transport.onDisconnect((reason) => losses.push(reason ?? 'unknown'));

    // 后台期事件未派发：直接改状态不 emit，回前台 visibilitychange 补查
    h.pc.connectionState = 'failed';
    doc.emit('visibilitychange');

    expect(losses).toEqual(['CONNECTION_FAILED']);
    expect(h.transport.state).toBe('FAILED');
    expect(h.controller.shouldAttempt()).toBe(true);
  });

  it('9. dispose：在途尝试立即收口 FAILED、owned 信令关闭、visibility 监听移除、后续信令帧静默', async () => {
    const doc = stubDocument();
    const h = makeHarness('host');
    await establishBattle(h, 'host');
    h.sessionWs.serverClose();
    h.pc.failConnection();

    const recheck = vi.spyOn(h.transport, 'recheckConnection');
    const pending = h.controller.attemptRecovery();
    await tick();
    const ws2 = h.rebuildWss[0];
    if (ws2 === undefined) {
      throw new Error('rebuild signaling client missing');
    }
    ws2.simulateOpen();
    await tick();
    ws2.serverSend(roomAckFrame('ROOM_JOINED'));
    await tick(); // ack → 重信令就绪 → restartOffer 已外发 → 等通道恢复
    expect(ws2.sentFrames().filter((f) => f['type'] === 'OFFER').length).toBe(1);

    h.controller.dispose();
    // dispose 打断在途等待 → 尝试链立即 FAILED（无 20s 悬挂 timer）
    await expect(pending).resolves.toBe('FAILED');

    // owned client 已关（socket CLOSED）；visibility 监听已摘
    expect(ws2.readyState).toBe(3);
    doc.emit('visibilitychange');
    expect(recheck).not.toHaveBeenCalled();
    expect(doc.listenerCount('visibilitychange')).toBe(0);
    expect(h.sessionClient.state).toBe('FAILED'); // session 信令不归本控制器处置（close 会置 DISCONNECTED）

    // dispose 后的信令帧静默处理（不抛不推进）
    ws2.serverSend(frame({ type: 'OFFER', sdp: 'whatever' }));
    await tick();
  });

  it('10. 重建信令跨结算保留，重赛再次恢复复用；退出会话关闭当前信令', async () => {
    const manager = new OnlineSessionManager();
    let session: OnlineSession;
    const h = makeHarness('host', {
      adoptSignaling: (client) => manager.replaceSignaling(session, client),
    });
    session = {
      role: 'host', localPlayerId: 'P1', remotePlayerId: 'P2',
      transport: h.transport, networkManager: h.nm, signaling: h.sessionClient,
      recovery: { roomCode: ROOM_CODE, peerToken: 'host-token' },
    };
    manager.store(session);
    await establishBattle(h, 'host');
    h.sessionWs.serverClose();
    h.pc.failConnection();
    const first = h.controller.attemptRecovery();
    await tick();
    const rebuiltWs = h.rebuildWss[0]!;
    rebuiltWs.simulateOpen();
    await tick();
    rebuiltWs.serverSend(roomAckFrame('ROOM_JOINED'));
    await tick();
    h.pc.restoreConnection();
    await tick();
    deliverPong(h, 'P2');
    await expect(first).resolves.toBe('RECOVERED');
    expect(manager.current?.signaling).not.toBe(h.sessionClient);
    h.controller.dispose(); // Battle → Result
    expect(rebuiltWs.readyState).toBe(1);

    const factory = vi.fn(() => { throw new Error('live session must be reused'); });
    const rematch = new RoomRecoveryController({
      role: 'host', transport: h.transport, networkManager: h.nm,
      signaling: manager.current!.signaling!, roomCode: ROOM_CODE, peerToken: 'host-token',
      createSignalingClient: factory,
      adoptSignaling: (client) => manager.replaceSignaling(session, client),
    });
    h.pc.failConnection();
    const second = rematch.attemptRecovery();
    await tick();
    expect(factory).not.toHaveBeenCalled();
    expect(rebuiltWs.sentFrames().filter((f) => f['type'] === 'OFFER')).toHaveLength(2);
    h.pc.restoreConnection();
    await tick();
    deliverPong(h, 'P2');
    await expect(second).resolves.toBe('RECOVERED');
    rematch.dispose();
    manager.disposeSession();
    expect(rebuiltWs.readyState).toBe(3);
    const staleClient = new SignalingClient({ url: 'ws://stale' });
    expect(manager.replaceSignaling(session, staleClient)).toBe(false);
    expect(manager.current).toBeNull();
    staleClient.close();
  });

  it('11. dispose 在 JOIN ack 等待时关闭未移交连接并立即结束恢复', async () => {
    const adopt = vi.fn(() => true);
    const h = makeHarness('host', { adoptSignaling: adopt });
    await establishBattle(h, 'host');
    h.sessionWs.serverClose();
    h.pc.failConnection();
    const pending = h.controller.attemptRecovery();
    await tick();
    const ws = h.rebuildWss[0]!;
    ws.simulateOpen();
    await tick();
    h.controller.dispose();
    await expect(pending).resolves.toBe('FAILED');
    expect(ws.readyState).toBe(3);
    ws.serverSend(roomAckFrame('ROOM_JOINED'));
    expect(adopt).not.toHaveBeenCalled();
  });

  it('12. 结算交接后，旧 Guest 异步 OFFER 不得继续生成或发送 ANSWER', async () => {
    const h = makeHarness('guest');
    await establishBattle(h, 'guest');
    let finish!: () => void;
    vi.spyOn(h.transport, 'acceptOffer').mockImplementation(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const answer = vi.spyOn(h.transport, 'beginAnswer');
    h.sessionWs.serverSend(frame({ type: 'OFFER', sdp: 'fake:restart-delayed' }));
    h.controller.dispose();
    finish();
    await tick();
    expect(h.sessionWs.readyState).toBe(1);
    expect(answer).not.toHaveBeenCalled();
    expect(sentTypes(h.sessionWs)).not.toContain('ANSWER');
    h.sessionClient.close();
    h.nm.dispose();
  });

  it('13. OFFER 提前失败后，迟到连接拒绝被收口，不产生未处理 rejection', async () => {
    const h = makeHarness('host', { maxAttempts: 1 });
    await establishBattle(h, 'host');
    let rejectConnect!: (error: Error) => void;
    vi.spyOn(h.transport, 'recoverConnect').mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectConnect = reject;
    }));
    vi.spyOn(h.transport, 'restartOffer').mockRejectedValue(new Error('offer failed'));
    h.pc.failConnection();
    await expect(h.controller.attemptRecovery()).resolves.toBe('FAILED');
    rejectConnect(new Error('late recovery timeout'));
    await tick(); // Vitest 会把未处理 rejection 作为测试错误
    h.controller.dispose();
    h.sessionClient.close();
    h.nm.dispose();
  });

  it('14. restartOffer 等待中 dispose 立即结束恢复，迟到 offer 不再发送', async () => {
    const h = makeHarness('host');
    await establishBattle(h, 'host');
    let finish!: (sdp: string) => void;
    vi.spyOn(h.transport, 'restartOffer').mockImplementation(() => new Promise<string>((resolve) => {
      finish = resolve;
    }));
    h.pc.failConnection();
    const pending = h.controller.attemptRecovery();
    await tick();
    h.controller.dispose();
    await expect(pending).resolves.toBe('FAILED');
    finish(JSON.stringify({ type: 'offer', sdp: 'fake:delayed' }));
    await tick();
    expect(sentTypes(h.sessionWs)).not.toContain('OFFER');
    h.sessionClient.close();
    h.nm.dispose();
  });
});
