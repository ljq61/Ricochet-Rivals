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
  await tick(); // createOffer → setLocalDescription → fake 进入 gathering
  h.pc.completeIceGathering();
  await tick(); // OFFER 帧落盘
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
  it('1. Host 全流：createRoom → ROOM_WAITING（房间码就绪）→ PEER_JOINED → OFFER 自动外发 → ANSWER 应用 → CONNECTED → PONG → VERIFIED + OnlineSession', async () => {
    const h = makeHarness();
    await hostAtConnected(h);

    // OFFER 已自动外发（用户零感知 SDP）
    const offerFrame = h.ws.sentFrames().find((f) => f['type'] === 'OFFER');
    expect(offerFrame).toMatchObject({ type: 'OFFER', sdp: 'fake:offer-sdp' });

    expect(h.controller.currentState).toBe(RoomConnectionState.CONNECTED);
    const channel = h.pc.dataChannels[0];
    if (channel === undefined) {
      throw new Error('host channel missing');
    }
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

  it('2. Guest 全流：joinRoom → ROOM_JOINED → NEGOTIATING → OFFER 应用 → ANSWER 自动外发 → CONNECTED → PONG → VERIFIED（P2）', async () => {
    const h = makeHarness();
    const pending = h.controller.joinRoom(ROOM_CODE);
    h.ws.simulateOpen();
    await tick();
    expect(h.ws.sentFrames()[0]?.['type']).toBe('JOIN_ROOM');
    h.ws.serverSend(roomAckFrame('ROOM_JOINED'));
    await pending;
    expect(h.controller.currentState).toBe(RoomConnectionState.NEGOTIATING);

    h.ws.serverSend(frame({ type: 'OFFER', sdp: 'fake:offer-sdp' }));
    await tick(); // acceptOffer → fake 产生 datachannel → createAnswer → gathering
    h.pc.completeIceGathering();
    await tick(); // ANSWER 外发 + connect pending

    const answerFrame = h.ws.sentFrames().find((f) => f['type'] === 'ANSWER');
    expect(answerFrame).toMatchObject({ type: 'ANSWER', sdp: 'fake:answer-sdp' });

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

  it('6. PEER_LEFT：协商期对端离开 → FAILED(PEER_LEFT)，在飞 offer 静默中止', async () => {
    const h = makeHarness();
    const pending = h.controller.createRoom();
    h.ws.simulateOpen();
    await tick();
    h.ws.serverSend(roomAckFrame('ROOM_CREATED'));
    await pending;
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    await tick(); // offer 挂起（gathering 中）
    h.ws.serverSend(frame({ type: 'PEER_LEFT' }));
    await tick();
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('PEER_LEFT');
    // offer 中止后不再外发（gather 未完成 → 帧面零 OFFER）
    expect(h.ws.sentFrames().some((f) => f['type'] === 'OFFER')).toBe(false);
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
