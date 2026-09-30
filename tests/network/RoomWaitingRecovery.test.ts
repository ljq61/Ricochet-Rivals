import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { RoomConnectionController } from '../../src/game/network/RoomConnectionController';
import { RoomConnectionState } from '../../src/game/network/RoomConnectionState';
import { OnlineSessionManager, type OnlineSession } from '../../src/game/network/OnlineSession';
import { SignalingClient } from '../../src/game/network/signaling/SignalingClient';
import { WebRTCTransport } from '../../src/game/network/WebRTCTransport';
import type { WebRTCConfig } from '../../src/game/network/WebRTCConfig';
import { serializeEnvelope } from '../../src/game/network/serialization/NetworkSerializer';
import { makeEnvelope } from './envelopeFixture';
import { FakeWebSocket, frame } from './signaling/fakeWebSocket';
import { FakeRTCPeerConnection, tick } from './webrtcFakes';

const ROOM_CODE = 'K7M4Q2';
const ICE_SERVERS = [{ urls: 'stun:stun.unit-test:3478' }];
const controllers: RoomConnectionController[] = [];

class VisibilityDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function makeHarness(failResumeTransport = false) {
  const document = new VisibilityDocument();
  vi.stubGlobal('document', document);
  const sockets: FakeWebSocket[] = [];
  const peers: FakeRTCPeerConnection[] = [];
  const configs: WebRTCConfig[] = [];
  const sessions: OnlineSession[] = [];
  const controller = new RoomConnectionController({
    createSignalingClient: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return new SignalingClient({
        url: 'ws://test/signaling',
        webSocketFactory: () => socket as unknown as WebSocket,
        connectTimeoutMs: 100,
      });
    },
    createTransport: (role, config) => {
      if (failResumeTransport && peers.length > 0) throw new Error('peer connection unavailable');
      const peer = new FakeRTCPeerConnection();
      peers.push(peer);
      configs.push(config);
      return new WebRTCTransport({
        role, config,
        peerConnectionFactory: () => peer as unknown as RTCPeerConnection,
        pcCloseDelayMs: 0,
      });
    },
    signalingJoinTimeoutMs: 80,
  });
  controller.onSession((session) => sessions.push(session));
  controllers.push(controller);
  return { controller, document, sockets, peers, configs, sessions };
}

type Harness = ReturnType<typeof makeHarness>;

async function flush(): Promise<void> {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await tick();
}

function roomAck(type: 'ROOM_CREATED' | 'ROOM_JOINED', overrides?: Record<string, unknown>): string {
  return frame({
    type, roomCode: ROOM_CODE, peerToken: 'host-token', iceServers: ICE_SERVERS,
    expiresAt: 1_800_000_000_000, ...overrides,
  });
}

async function createWaitingRoom(h: Harness): Promise<FakeWebSocket> {
  const pending = h.controller.createRoom();
  const socket = h.sockets[0]!;
  socket.simulateOpen();
  await flush();
  socket.serverSend(roomAck('ROOM_CREATED'));
  await pending;
  expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
  return socket;
}

async function openResume(h: Harness, index = 1): Promise<FakeWebSocket> {
  const socket = h.sockets[index]!;
  socket.simulateOpen();
  await flush();
  expect(socket.sentFrames()).toEqual([
    { v: 1, type: 'JOIN_ROOM', roomCode: ROOM_CODE, peerToken: 'host-token' },
  ]);
  return socket;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Host waiting room background recovery', () => {
  it('保留原码/token：后台断线不消耗预算，回前台恢复，随后正常协商验证并移交新信令', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    h.document.setVisibility('hidden');
    original.serverClose();
    expect(h.controller.currentState).toBe(RoomConnectionState.RECONNECTING_SIGNALING);
    expect(h.controller.currentRoomCode).toBe(ROOM_CODE);
    expect(h.controller.currentPeerToken).toBe('host-token');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.controller.lastFailure).toBeNull();

    h.document.setVisibility('visible');
    const resumed = await openResume(h);
    const refreshedIce = [{ urls: 'turn:turn.unit-test:3478', username: 'fresh', credential: 'new' }];
    resumed.serverSend(roomAck('ROOM_JOINED', { iceServers: refreshedIce }));
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
    expect(h.controller.currentRoomCode).toBe(ROOM_CODE);
    expect(h.configs[1]?.iceServers).toEqual(refreshedIce);
    expect(h.peers[0]?.closed).toBe(true);
    expect(h.sockets).toHaveLength(2);
    expect(resumed.sentFrames().some((item) => item['type'] === 'CREATE_ROOM')).toBe(false);

    resumed.serverSend(frame({ type: 'PEER_JOINED' }));
    await flush();
    resumed.serverSend(frame({ type: 'ANSWER', sdp: 'fake:answer-sdp' }));
    await flush();
    const channel = h.peers[1]!.dataChannels[0]!;
    channel.simulateOpen();
    await flush();
    channel.emit('message', { data: serializeEnvelope(makeEnvelope({
      type: NetworkMessageType.PONG,
      matchId: `online-room-${ROOM_CODE}`, turnId: 0, senderId: 'P2',
      payload: { sentAt: Date.now() },
    })) });
    await flush();
    expect(h.controller.currentState).toBe(RoomConnectionState.VERIFIED);
    expect(h.sessions[0]?.recovery).toEqual({ roomCode: ROOM_CODE, peerToken: 'host-token' });
    h.document.setVisibility('hidden');
    h.document.setVisibility('visible');
    expect(h.sockets).toHaveLength(2);

    const manager = new OnlineSessionManager();
    manager.store(h.sessions[0]!);
    h.controller.detach();
    h.controller.dispose();
    expect(resumed.readyState).toBe(1);
    manager.disposeSession();
    expect(resumed.readyState).toBe(3);
  });

  it('visible主动接管仍显示OPEN的旧socket，重复visible和旧事件不重连、不破坏新房间', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    h.document.setVisibility('hidden');
    expect(original.readyState).toBe(1);
    h.document.setVisibility('visible');
    h.document.setVisibility('visible');
    expect(h.sockets).toHaveLength(2);
    expect(original.readyState).toBe(1); // 新token接管前保留旧socket，Guest不会先收到PEER_LEFT。
    const resumed = await openResume(h);
    resumed.serverSend(roomAck('ROOM_JOINED'));
    expect(original.readyState).toBe(3);
    expect(original.listenerCount('message')).toBe(0);
    original.serverSend(frame({ type: 'ERROR', code: 'ROOM_EXPIRED' }));
    original.simulateError();
    original.serverClose();
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
    expect(h.controller.lastFailure).toBeNull();
  });

  it.each([false, true])('Guest在Host后台已JOIN，先token接管后关闭旧WS，双端VERIFIED（JOIN已送达后再次hidden=%s）', async (hiddenAgain) => {
    if (hiddenAgain) vi.useFakeTimers();
    const host = makeHarness();
    const original = await createWaitingRoom(host);
    host.document.setVisibility('hidden');
    const guest = makeHarness();
    const joined = guest.controller.joinRoom(ROOM_CODE);
    const guestSocket = guest.sockets[0]!;
    guestSocket.simulateOpen();
    await flush();
    guestSocket.serverSend(roomAck('ROOM_JOINED', { peerToken: 'guest-token' }));
    original.serverSend(frame({ type: 'PEER_JOINED' }));
    await joined;
    expect(guest.controller.currentState).toBe(RoomConnectionState.NEGOTIATING);

    let tokenClaimed = false;
    const closeOriginal = original.close.bind(original);
    vi.spyOn(original, 'close').mockImplementation(() => {
      closeOriginal();
      // 与SignalingRoomServer一致：接管前旧socket先关会向Guest广播PEER_LEFT。
      if (!tokenClaimed) guestSocket.serverSend(frame({ type: 'PEER_LEFT' }));
    });
    host.document.setVisibility('visible');
    expect(original.readyState).toBe(1);
    const resumed = await openResume(host);
    tokenClaimed = true; // 服务器JOIN_ROOM(hostToken)已原位替换binding。
    if (hiddenAgain) {
      const closeResumed = resumed.close.bind(resumed);
      vi.spyOn(resumed, 'close').mockImplementation(() => {
        closeResumed();
        guestSocket.serverSend(frame({ type: 'PEER_LEFT' }));
      });
      host.document.setVisibility('hidden');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(resumed.readyState).toBe(1);
      expect(guest.controller.lastFailure).toBeNull();
      host.document.setVisibility('visible');
      expect(host.sockets).toHaveLength(2); // ack未派发时，继续等待本次接管，不重复拨号。
    }
    resumed.serverSend(roomAck('ROOM_JOINED'));
    resumed.serverSend(frame({ type: 'PEER_JOINED' }));
    await flush();
    expect(guest.controller.lastFailure).toBeNull();
    const offer = resumed.sentFrames().find((item) => item['type'] === 'OFFER')!;
    guestSocket.serverSend(frame({ type: 'OFFER', sdp: offer['sdp'] }));
    await flush();
    const answer = guestSocket.sentFrames().find((item) => item['type'] === 'ANSWER')!;
    resumed.serverSend(frame({ type: 'ANSWER', sdp: answer['sdp'] }));
    await flush();
    for (const h of [host, guest]) {
      const channel = h.peers.at(-1)!.dataChannels[0]!;
      channel.simulateOpen();
    }
    await flush();
    for (const [h, senderId] of [[host, 'P2'], [guest, 'P1']] as const) {
      h.peers.at(-1)!.dataChannels[0]!.emit('message', { data: serializeEnvelope(makeEnvelope({
        type: NetworkMessageType.PONG,
        matchId: `online-room-${ROOM_CODE}`, turnId: 0, senderId,
        payload: { sentAt: Date.now() },
      })) });
    }
    await flush();
    expect(host.controller.currentState).toBe(RoomConnectionState.VERIFIED);
    expect(guest.controller.currentState).toBe(RoomConnectionState.VERIFIED);
    expect(original.readyState).toBe(3);
    for (const h of [host, guest]) {
      const manager = new OnlineSessionManager();
      manager.store(h.sessions[0]!);
      h.controller.detach();
      manager.disposeSession();
    }
  });

  it('后台收到PEER_JOINED延迟首轮offer，恢复后在场通知只发一次offer', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    h.document.setVisibility('hidden');
    original.serverSend(frame({ type: 'PEER_JOINED' }));
    await flush();
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
    expect(original.sentFrames().some((item) => item['type'] === 'OFFER')).toBe(false);
    h.document.setVisibility('visible');
    const resumed = await openResume(h);
    resumed.serverSend(roomAck('ROOM_JOINED'));
    resumed.serverSend(frame({ type: 'PEER_JOINED' }));
    resumed.serverSend(frame({ type: 'PEER_JOINED' }));
    await flush();
    expect(h.controller.currentState).toBe(RoomConnectionState.NEGOTIATING);
    expect(resumed.sentFrames().filter((item) => item['type'] === 'OFFER')).toHaveLength(1);
  });

  it('后台尚未发offer的guest离开保留等待房间', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    h.document.setVisibility('hidden');
    original.serverSend(frame({ type: 'PEER_JOINED' }));
    original.serverSend(frame({ type: 'PEER_LEFT' }));
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
    expect(h.controller.currentRoomCode).toBe(ROOM_CODE);
  });

  it('前台等待期普通WS断线也用token恢复；重连自身失败按真实错误收口', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverClose();
    expect(h.controller.currentState).toBe(RoomConnectionState.RECONNECTING_SIGNALING);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.simulateError();
    await flush();
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('SIGNALING_FAILED');
    expect(h.sockets).toHaveLength(2);
  });

  it.each(['ROOM_EXPIRED', 'ROOM_NOT_FOUND'])('恢复时server %s保持原始code且不偷偷新建房间', async (code) => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverClose();
    const resumed = await openResume(h);
    resumed.serverSend(frame({ type: 'ERROR', code }));
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure).toMatchObject({ reason: 'SERVER_ERROR', code });
    expect(h.sockets).toHaveLength(2);
  });

  it('恢复ack超时失败并释放socket，不无限等待', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverClose();
    const resumed = await openResume(h);
    await vi.advanceTimersByTimeAsync(81);
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('SIGNALING_FAILED');
    expect(h.controller.lastFailure?.detail).toContain('rejoin timed out');
    expect(resumed.readyState).toBe(3);
  });

  it('恢复期间再次隐藏暂停ack预算，回前台继续同次claim', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverClose();
    const interrupted = await openResume(h);
    h.document.setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(interrupted.readyState).toBe(1);
    expect(h.controller.lastFailure).toBeNull();
    h.document.setVisibility('visible');
    expect(h.sockets).toHaveLength(2);
    interrupted.serverSend(roomAck('ROOM_JOINED'));
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
  });

  it('接管期间再次hidden保留新旧live socket，恢复失败清理全部socket', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    h.document.setVisibility('hidden');
    h.document.setVisibility('visible');
    const interrupted = await openResume(h);
    h.document.setVisibility('hidden');
    expect(original.readyState).toBe(1);
    expect(interrupted.readyState).toBe(1);
    h.document.setVisibility('visible');
    expect(h.sockets).toHaveLength(2);
    interrupted.simulateError();
    await flush();
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.sockets.every((socket) => socket.readyState === 3)).toBe(true);
  });

  it('重入拨号期间再次hidden，连接超时保留旧WS直到下一次visible再恢复', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    h.document.setVisibility('hidden');
    h.document.setVisibility('visible');
    const interrupted = h.sockets[1]!;
    h.document.setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(101);
    expect(original.readyState).toBe(1);
    expect(interrupted.readyState).toBe(3);
    expect(h.controller.lastFailure).toBeNull();
    h.document.setVisibility('visible');
    const resumed = await openResume(h, 2);
    resumed.serverSend(roomAck('ROOM_JOINED'));
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
    expect(original.readyState).toBe(3);
  });

  it('后台冻结WS-open计时器时，visible安全重拨尚未JOIN的socket并重置拨号预算', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    h.document.setVisibility('hidden');
    h.document.setVisibility('visible');
    const interrupted = h.sockets[1]!;
    h.document.setVisibility('hidden');
    vi.setSystemTime(Date.now() + 60_000); // iOS冻结timer，超时尚未派发。
    h.document.setVisibility('visible');
    expect(interrupted.readyState).toBe(3);
    expect(original.readyState).toBe(1);
    const resumed = await openResume(h, 2);
    resumed.serverSend(roomAck('ROOM_JOINED'));
    await vi.advanceTimersByTimeAsync(101);
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
    expect(h.controller.lastFailure).toBeNull();
  });

  it('拒绝恢复ack身份变化，不能获得新guest token或更换房间码', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverClose();
    const resumed = await openResume(h);
    resumed.serverSend(roomAck('ROOM_JOINED', { peerToken: 'guest-token' }));
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('SETUP_FAILED');
    expect(h.peers).toHaveLength(1);
  });

  it('retry后迟到的恢复拨号与旧ack不能污染新的尝试', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverClose();
    const obsolete = h.sockets[1]!;
    h.controller.retry();
    const next = h.controller.createRoom();
    const current = h.sockets[2]!;
    current.simulateOpen();
    obsolete.simulateOpen();
    obsolete.serverSend(roomAck('ROOM_JOINED'));
    await flush();
    expect(h.controller.currentState).toBe(RoomConnectionState.CREATING_ROOM);
    current.serverSend(roomAck('ROOM_CREATED'));
    await next;
    expect(h.controller.currentState).toBe(RoomConnectionState.ROOM_WAITING);
    expect(obsolete.sentFrames()).toEqual([]);
    expect(h.sockets).toHaveLength(3);
  });

  it.each(['back', 'dispose'] as const)('%s关闭待恢复连接和visibility监听，迟到事件不复活房间', async (action) => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverClose();
    const obsolete = h.sockets[1]!;
    h.controller[action]();
    obsolete.simulateOpen();
    obsolete.serverSend(roomAck('ROOM_JOINED'));
    await flush();
    expect(h.controller.currentState).toBe(RoomConnectionState.CLOSED);
    expect(obsolete.sentFrames()).toEqual([]);
    h.document.setVisibility('hidden');
    h.document.setVisibility('visible');
    expect(h.sockets).toHaveLength(2);
  });

  it('重建transport失败保持SETUP_FAILED，不被ROOM_WAITING覆盖', async () => {
    const h = makeHarness(true);
    const original = await createWaitingRoom(h);
    original.serverClose();
    const resumed = await openResume(h);
    resumed.serverSend(roomAck('ROOM_JOINED'));
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('SETUP_FAILED');
    expect(resumed.readyState).toBe(3);
  });

  it('协商已开始后不重放旧SDP，WS失败保持原有失败边界', async () => {
    const h = makeHarness();
    const original = await createWaitingRoom(h);
    original.serverSend(frame({ type: 'PEER_JOINED' }));
    await flush();
    h.document.setVisibility('hidden');
    original.serverClose();
    h.document.setVisibility('visible');
    expect(h.controller.currentState).toBe(RoomConnectionState.FAILED);
    expect(h.controller.lastFailure?.reason).toBe('SIGNALING_FAILED');
    expect(h.sockets).toHaveLength(1);
  });
});
