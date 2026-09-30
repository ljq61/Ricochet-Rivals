import { describe, expect, it } from 'vitest';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import {
  RoomConnectionController,
  type RoomConnectionControllerOptions,
} from '../../src/game/network/RoomConnectionController';
import {
  RoomConnectionState,
  type RoomConnectionFailure,
} from '../../src/game/network/RoomConnectionState';
import { OnlineSession, OnlineSessionManager } from '../../src/game/network/OnlineSession';
import { SignalingClient } from '../../src/game/network/signaling/SignalingClient';
import { WebRTCTransport } from '../../src/game/network/WebRTCTransport';
import { serializeEnvelope } from '../../src/game/network/serialization/NetworkSerializer';
import { makeEnvelope } from './envelopeFixture';
import { FakeWebSocket, frame } from './signaling/fakeWebSocket';
import {
  FakeRTCPeerConnection,
  tick,
} from './webrtcFakes';

/**
 * RoomConnectionController（SG-3）—— 房间码自动配对编排器全矩阵。
 * 双 fake 驱动：FakeWebSocket（信令侧）+ FakeRTCPeerConnection（DataChannel 侧），
 * 测试扮演 Signaling Server 推送 ROOM ack / PEER_JOINED / OFFER / ANSWER。
 * Host / Guest 全流走满到 VERIFIED + OnlineSession（含 session.signaling 交接）。
 */

const ROOM_CODE = 'K7M4Q2';
const ICE_SERVERS = [{ urls: 'stun:stun.unit-test:3478' }];

interface RoomHarness {
  readonly controller: RoomConnectionController;
  readonly ws: FakeWebSocket;
  readonly pc: FakeRTCPeerConnection;
  readonly states: RoomConnectionState[];
  readonly failures: RoomConnectionFailure[];
  readonly sessions: OnlineSession[];
}

function makeHarness(
  timeouts?: { negotiationTimeoutMs?: number; verificationTimeoutMs?: number },
): RoomHarness {
  const ws = new FakeWebSocket();
  const pc = new FakeRTCPeerConnection();
  const options: RoomConnectionControllerOptions = {
    createTransport: (r, config) =>
      new WebRTCTransport({
        role: r,
        config,
        peerConnectionFactory: () => pc as unknown as RTCPeerConnection,
      }),
    createSignalingClient: () =>
      new SignalingClient({
        url: 'ws://127.0.0.1:8787/signaling',
        webSocketFactory: () => ws as unknown as WebSocket,
      }),
    negotiationTimeoutMs: timeouts?.negotiationTimeoutMs,
    verificationTimeoutMs: timeouts?.verificationTimeoutMs,
  };
  const controller = new RoomConnectionController(options);
  const states: RoomConnectionState[] = [];
  const failures: RoomConnectionFailure[] = [];
  const sessions: OnlineSession[] = [];
  controller.onStateChange((state) => states.push(state));
  controller.onFailure((failure) => failures.push(failure));
  controller.onSession((session) => sessions.push(session));
  return { controller, ws, pc, states, failures, sessions };
}

/** 服务器侧 ROOM ack 帧 */
function roomAckFrame(type: 'ROOM_CREATED' | 'ROOM_JOINED'): string {
  return frame({
    type,
    roomCode: ROOM_CODE,
    peerToken: type === 'ROOM_CREATED' ? 'host-token' : 'guest-token',
    iceServers: ICE_SERVERS,
    expiresAt: 1_800_000_000_000,
  });
}

/** PONG wire（经 DataChannel；senderId 为对端） */
function pongWire(senderId: 'P1' | 'P2'): string {
  return serializeEnvelope(
    makeEnvelope({
      type: NetworkMessageType.PONG,
      matchId: `online-room-${ROOM_CODE}`,
      turnId: 0,
      senderId,
      payload: { sentAt: Date.now() },
    }),
  );
}

/** Host 流推进到 NEGOTIATING（PEER_JOINED 已到，Offer gather 已完成） */
async function hostAtNegotiating(h: RoomHarness): Promise<void> {
  const pending = h.controller.createRoom();
  h.ws.simulateOpen();
  await tick();
  h.ws.serverSend(roomAckFrame('ROOM_CREATED'));
  await pending;
  expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);

  h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
  await tick(); // Trickle（SG-4）：beginOffer 即时外发，不等 gathering
}

/** Host 全流推进到 CONNECTED（通道已开、PING 已发，等 PONG） */
async function hostAtConnected(h: RoomHarness): Promise<void> {
  await hostAtNegotiating(h);
  h.ws.serverSend(frame({ type: 'ANSWER', sdp: 'fake:answer-sdp' }));
  await tick(); // acceptAnswer → connectAndVerify → connect pending
  const channel = h.pc.dataChannels[0];
  if (channel === undefined) {
    throw new Error('host channel missing');
  }
  channel.simulateOpen();
  await tick();
}

function expectAnyRejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected promise to reject');
    },
    (error) => {
      if (error instanceof Error) {
        return error;
      }
      throw error;
    },
  );
}

describe('RoomConnectionController', () => {
  it('1. Host 全流 + Trickle：OFFER 即时外发 → candidate 顺序外发 → ICE_END → 对端 candidate（含畸形）落库不崩 → PONG → VERIFIED', async () => {
    const h = makeHarness();
    await hostAtNegotiating(h);

    // OFFER 已自动外发（Trickle：不等 gathering —— 用户零感知 SDP）
    const offerFrame = h.ws.sentFrames().find((f) => f['type'] === 'OFFER');
    expect(offerFrame).toMatchObject({ type: 'OFFER', sdp: 'fake:offer-sdp' });

    // 本地 candidate 逐个外发（顺序保持）
    h.pc.emitLocalCandidate({ candidate: 'candidate:1 1 UDP 1 192.168.1.10 40000 typ host', sdpMid: '0' });
    h.pc.emitLocalCandidate({ candidate: 'candidate:2 1 UDP 1 8.8.8.8 40001 typ srflx', sdpMid: '0' });
    await tick();
    const candFrames = h.ws.sentFrames().filter((f) => f['type'] === 'ICE_CANDIDATE');
    expect(candFrames.length).toBe(2);
    expect((candFrames[0]?.['candidate'] as { candidate?: string }).candidate).toContain('192.168.1.10');
    expect((candFrames[1]?.['candidate'] as { candidate?: string }).candidate).toContain('8.8.8.8');

    // gathering 完结（null candidate）→ ICE_END 外发
    h.pc.completeIceGathering();
    await tick();
    expect(h.ws.sentFrames().some((f) => f['type'] === 'ICE_END')).toBe(true);

    // ANSWER 应用 → 对端 candidate 直通落库；畸形 candidate 拒收不崩、后续合法仍可加
    h.ws.serverSend(frame({ type: 'ANSWER', sdp: 'fake:answer-sdp' }));
    await tick();
    h.ws.serverSend(frame({ type: 'ICE_CANDIDATE', candidate: { candidate: 'garbage-line', sdpMid: '0' } }));
    h.ws.serverSend(frame({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:9 1 UDP 1 172.16.0.9 50000 typ host', sdpMid: '0' } }));
    await tick();
    expect(h.pc.addedCandidates.length).toBe(1); // 只落合法那枚
    expect(h.pc.addedCandidates[0]?.candidate).toContain('172.16.0.9');

    const channel = h.pc.dataChannels[0];
    if (channel === undefined) {
      throw new Error('host channel missing');
    }
    channel.simulateOpen();
    await tick();
    expect(h.controller.currentState).toBe(RoomConnectionState.CONNECTED);

    // PING 已发（验证流启动）
    expect(channel.sent.some((raw) => raw.includes('"PING"'))).toBe(true);

    channel.emit('message', { data: pongWire('P2') });
    await tick();

    expect(h.controller.currentState).toBe(RoomConnectionState.VERIFIED);
    expect(h.controller.currentRoomCode).toBe(ROOM_CODE);
    expect(h.controller.currentPeerToken).toBe('host-token');
    const session = h.sessions[0];
    expect(session).toBeDefined();
    if (!session) return;
    expect(session.role).toBe('host');
    expect(session.localPlayerId).toBe('P1');
    expect(session.remotePlayerId).toBe('P2');
    expect(session.signaling).toBeDefined();
    // 状态序列：全流无 FAILED / CLOSED
    expect(h.states).not.toContain(RoomConnectionState.FAILED);
    expect(h.failures).toEqual([]);
  });

  it('2. Guest 全流 + Trickle：candidate 先于 OFFER 到达（排队）→ OFFER 应用后 flush → ANSWER 自动外发 → candidate/ICE_END → PONG → VERIFIED（P2）', async () => {
    const h = makeHarness();
    const pending = h.controller.joinRoom(ROOM_CODE);
    h.ws.simulateOpen();
    await tick();
    expect(h.ws.sentFrames()[0]?.['type']).toBe('JOIN_ROOM');
    h.ws.serverSend(roomAckFrame('ROOM_JOINED'));
    await pending;
    expect(h.controller.currentState).toBe(RoomConnectionState.NEGOTIATING);

    // Trickle 常态：Host 的 candidate 与 OFFER 同波先后到达 —— candidate 先入队
    h.ws.serverSend(frame({ type: 'OFFER', sdp: 'fake:offer-sdp' }));
    h.ws.serverSend(frame({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:7 1 UDP 1 10.0.0.7 41000 typ host', sdpMid: '0' } }));
    await tick(); // acceptOffer（remoteDescription set → 队列 flush）→ beginAnswer → ANSWER 即时外发

    const answerFrame = h.ws.sentFrames().find((f) => f['type'] === 'ANSWER');
    expect(answerFrame).toMatchObject({ type: 'ANSWER', sdp: 'fake:answer-sdp' });
    // 先到的 candidate 已 flush 落库（candidate-before-remoteDescription 队列路径）
    expect(h.pc.addedCandidates.length).toBe(1);
    expect(h.pc.addedCandidates[0]?.candidate).toContain('10.0.0.7');

    // Guest 本地 candidate 外发 + ICE_END
    h.pc.emitLocalCandidate({ candidate: 'candidate:8 1 UDP 1 10.0.0.8 42000 typ host', sdpMid: '0' });
    await tick();
    const candFrames = h.ws.sentFrames().filter((f) => f['type'] === 'ICE_CANDIDATE');
    expect(candFrames.length).toBe(1);
    expect((candFrames[0]?.['candidate'] as { candidate?: string }).candidate).toContain('10.0.0.8');
    h.pc.completeIceGathering(); // null candidate → ICE_END
    await tick();
    expect(h.ws.sentFrames().some((f) => f['type'] === 'ICE_END')).toBe(true);

    const channel = h.pc.dataChannels[0]; // guest 通道经 datachannel 事件挂载
    if (channel === undefined) {
      throw new Error('guest channel missing');
    }
    channel.simulateOpen();
    await tick();
    expect(h.controller.currentState).toBe(RoomConnectionState.CONNECTED);

    channel.emit('message', { data: pongWire('P1') });
    await tick();

    expect(h.controller.currentState).toBe(RoomConnectionState.VERIFIED);
    const session = h.sessions[0];
    if (!session) throw new Error('session missing');
    expect(session.role).toBe('guest');
    expect(session.localPlayerId).toBe('P2');
    expect(session.remotePlayerId).toBe('P1');
    expect(h.failures).toEqual([]);
  });

  it('3. INVALID_ROOM_CODE：非法码本端拒绝，零帧发出，reject + failure 可读', async () => {
    const h = makeHarness();
    const pending = h.controller.joinRoom('BAD1'); // 非法字符 1
    const guardedRejection = expectAnyRejection(pending); // 挂 handler 必须先于 rejection（防 unhandled）
    h.ws.simulateOpen();
    await tick();
    await guardedRejection;
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('INVALID_ROOM_CODE');
    expect(h.ws.sentFrames().some((f) => f['type'] === 'JOIN_ROOM')).toBe(false);
  });

  it('4. SIGNALING_FAILED：WS 拨号失败 → reject + 状态 FAILED', async () => {
    const h = makeHarness();
    const pending = h.controller.createRoom();
    h.ws.simulateError();
    await expectAnyRejection(pending);
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('SIGNALING_FAILED');
  });

  it('5. SERVER_ERROR：入房被拒（ROOM_FULL）→ code 保留，reject + FAILED', async () => {
    const h = makeHarness();
    const pending = h.controller.joinRoom(ROOM_CODE);
    h.ws.simulateOpen();
    await tick();
    h.ws.serverSend(frame({ type: 'ERROR', code: 'ROOM_FULL', message: 'room is full' }));
    await expectAnyRejection(pending);
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('SERVER_ERROR');
    expect(h.controller.lastFailure?.code).toBe('ROOM_FULL');
  });

  it('6. PEER_LEFT：协商期对端离开 → FAILED(PEER_LEFT)，OFFER 已按 Trickle 即时外发、后续 candidate 余波不再外发', async () => {
    const h = makeHarness();
    const pending = h.controller.createRoom();
    h.ws.simulateOpen();
    await tick();
    h.ws.serverSend(roomAckFrame('ROOM_CREATED'));
    await pending;
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    await tick(); // Trickle：beginOffer 即时外发（不等 gathering —— SG-4 语义）
    h.ws.serverSend(frame({ type: 'PEER_LEFT' }));
    await tick();
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('PEER_LEFT');
    expect(h.ws.sentFrames().some((f) => f['type'] === 'OFFER')).toBe(true);

    // fail 后 transport 已关：本地 candidate 余波（emit 无人听）不再外发
    h.pc.emitLocalCandidate({ candidate: 'candidate:1 1 UDP 1 192.168.1.4 54321 typ host', sdpMid: '0' });
    await tick();
    expect(h.ws.sentFrames().filter((f) => f['type'] === 'ICE_CANDIDATE').length).toBe(0);
  });

  it('7. CONNECT_FAILED：协商窗口超时（PEER_JOINED 后无 ANSWER）→ FAILED', async () => {
    const h = makeHarness({ negotiationTimeoutMs: 50 });
    const pending = h.controller.createRoom();
    h.ws.simulateOpen();
    await tick();
    h.ws.serverSend(roomAckFrame('ROOM_CREATED'));
    await pending;
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    await tick();
    h.pc.completeIceGathering();
    await tick(); // OFFER 已发，ANSWER 永不到来
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('CONNECT_FAILED');
    expect(h.controller.lastFailure?.detail).toContain('negotiation window');
  });

  it('8. CONNECT_FAILED：ANSWER 已应用但 DataChannel 永不 open → transport 超时 reject', async () => {
    const h = makeHarness({ negotiationTimeoutMs: 80 });
    const pending = h.controller.createRoom();
    h.ws.simulateOpen();
    await tick();
    h.ws.serverSend(roomAckFrame('ROOM_CREATED'));
    await pending;
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    await tick();
    h.pc.completeIceGathering();
    await tick();
    h.ws.serverSend(frame({ type: 'ANSWER', sdp: 'fake:answer-sdp' }));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('CONNECT_FAILED');
    expect(h.controller.lastFailure?.detail).toContain('data channel failed');
  });

  it('9. VERIFICATION_TIMEOUT：CONNECTED 后窗口内无 PONG → FAILED', async () => {
    const h = makeHarness({ verificationTimeoutMs: 40 });
    await hostAtConnected(h);
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('VERIFICATION_TIMEOUT');
  });

  it('10. CONNECT_FAILED：验证前通道中断（对端关闭）→ FAILED（含 reason 细节）', async () => {
    const h = makeHarness();
    await hostAtConnected(h);
    const channel = h.pc.dataChannels[0];
    if (channel === undefined) {
      throw new Error('host channel missing');
    }
    channel.close();
    await tick();

    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('CONNECT_FAILED');
    expect(h.controller.lastFailure?.detail).toContain('CHANNEL_CLOSED');
  });

  it('11. retry：FAILED 后回 IDLE，可重新开始新尝试；旧 signaling 已关', async () => {
    const h = makeHarness();
    const pending = h.controller.joinRoom('BAD1'); // 非法字符 1
    const guardedRejection = expectAnyRejection(pending); // 挂 handler 必须先于 rejection
    h.ws.simulateOpen();
    await tick();
    await guardedRejection;
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);

    expect(h.ws.readyState).toBe(3); // 旧信令已彻底关闭
    h.controller.retry();
    expect(h.controller.currentState).toBe(RoomConnectionState.IDLE);
    expect(h.controller.lastFailure).toBeNull();

    // 新尝试可完整走通（同一 fake ws 复用：旧 listener 已摘，新 client 重新拨号）
    const second = h.controller.joinRoom(ROOM_CODE);
    h.ws.simulateOpen();
    await tick();
    h.ws.serverSend(roomAckFrame('ROOM_JOINED'));
    await second;
    expect(h.controller.currentState).toBe(RoomConnectionState.NEGOTIATING);
  });

  it('12. back / dispose：彻底清理 + CLOSED 幂等', async () => {
    const h = makeHarness();
    const pending = h.controller.createRoom();
    h.ws.simulateOpen();
    await tick();
    h.ws.serverSend(roomAckFrame('ROOM_CREATED'));
    await pending;

    h.controller.back();
    expect(h.controller.currentState).toBe(RoomConnectionState.CLOSED);
    expect(h.ws.readyState).toBe(3);

    h.controller.back(); // 幂等
    h.controller.dispose();
    h.controller.dispose();
    expect(h.controller.currentState).toBe(RoomConnectionState.CLOSED);
  });

  it('13. detach + SessionManager dispose 链：session.signaling 随会话收口（对局存活 / dispose 关闭）', async () => {
    const h = makeHarness();
    await hostAtConnected(h);
    h.pc.dataChannels[0]?.emit('message', { data: pongWire('P2') });
    await tick();
    expect(h.controller.currentState).toBe(RoomConnectionState.VERIFIED);

    const session = h.sessions[0];
    if (!session) throw new Error('session missing');
    expect(session.signaling?.state).toBe('NEGOTIATING'); // 对局期信令通道存活（SG-8 重启用）

    const sessionManager = new OnlineSessionManager();
    sessionManager.store(session);
    h.controller.detach();
    h.controller.dispose(); // detach 后 no-op：不销毁已交接资源
    expect(h.pc.dataChannels[0]?.readyState).toBe('open'); // transport 存活

    sessionManager.disposeSession();
    expect(h.pc.dataChannels[0]?.readyState).toBe('closed');
    expect(session.signaling?.state).toBe('DISCONNECTED');
    expect(h.ws.readyState).toBe(3);
  });
});
