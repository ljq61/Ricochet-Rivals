import { describe, expect, it } from 'vitest';
import { RoomManager } from '../src/RoomManager';
import { SignalingRoomServer } from '../src/SignalingRoomServer';
import { clientFrame, FakeClock, FakeSignalingSocket } from './signalingFakes';

/**
 * SignalingRoomServer（SG-2）—— 消息分发矩阵（FakeSocket 驱动）。
 * 规格矩阵的分发侧半边：malformed / duplicate join / relay / peer leave /
 * reconnect identity 端到端 / 房间隔离 / sweep 通知。
 */

const ICE_SERVERS = [{ urls: 'stun:stun.example.com:3478' }];
const WAITING_TTL_MS = 600_000;
const SLOT_GRACE_MS = 30_000;

function makeServer(clock: FakeClock): { server: SignalingRoomServer; manager: RoomManager } {
  const manager = new RoomManager({
    now: () => clock.current(),
    waitingTtlMs: WAITING_TTL_MS,
    slotGraceMs: SLOT_GRACE_MS,
  });
  const server = new SignalingRoomServer({
    manager,
    provideIceServers: () => ICE_SERVERS,
    now: () => clock.current(),
  });
  return { server, manager };
}

interface PairedRoom {
  server: SignalingRoomServer;
  host: FakeSignalingSocket;
  guest: FakeSignalingSocket;
  roomCode: string;
  hostToken: string;
  guestToken: string;
}

function makeServerAndHost(clock: FakeClock): { server: SignalingRoomServer; host: FakeSignalingSocket; roomCode: string; hostToken: string } {
  const { server } = makeServer(clock);
  const host = new FakeSignalingSocket('host');
  server.handleMessage(host, clientFrame({ type: 'CREATE_ROOM' }));
  const ack = host.lastFrame();
  const roomCode = ack?.['roomCode'];
  const hostToken = ack?.['peerToken'];
  if (typeof roomCode !== 'string' || typeof hostToken !== 'string') {
    throw new Error(`setup CREATE_ROOM ack malformed: ${JSON.stringify(ack)}`);
  }
  return { server, host, roomCode, hostToken };
}

function makePairedRoom(clock: FakeClock): PairedRoom {
  const { server, host, roomCode, hostToken } = makeServerAndHost(clock);
  const guest = new FakeSignalingSocket('guest');
  server.handleMessage(guest, clientFrame({ type: 'JOIN_ROOM', roomCode }));
  const guestAck = guest.lastFrame();
  const guestToken = guestAck?.['peerToken'];
  if (typeof guestToken !== 'string') {
    throw new Error(`setup JOIN_ROOM ack malformed: ${JSON.stringify(guestAck)}`);
  }
  host.clear();
  guest.clear();
  return { server, host, guest, roomCode, hostToken, guestToken };
}

describe('SignalingRoomServer', () => {
  it('1. CREATE_ROOM → ROOM_CREATED ack（code/token/iceServers/expiresAt）；host 收 ROOM_EXPIRED 前无对端事件', () => {
    const clock = new FakeClock();
    const { server } = makeServer(clock);
    const host = new FakeSignalingSocket('host');
    server.handleMessage(host, clientFrame({ type: 'CREATE_ROOM' }));

    const ack = host.lastFrame();
    expect(ack?.['type']).toBe('ROOM_CREATED');
    expect(typeof ack?.['roomCode']).toBe('string');
    expect(typeof ack?.['peerToken']).toBe('string');
    expect(ack?.['iceServers']).toEqual(ICE_SERVERS);
    expect(ack?.['expiresAt']).toBe(clock.current() + WAITING_TTL_MS);
    expect(ack?.['v']).toBe(1);
    expect(server.boundSocketCount).toBe(1);
  });

  it('2. JOIN_ROOM → guest ROOM_JOINED + host PEER_JOINED', () => {
    const clock = new FakeClock();
    const { server, host, roomCode } = makeServerAndHost(clock);
    const guest = new FakeSignalingSocket('guest');
    server.handleMessage(guest, clientFrame({ type: 'JOIN_ROOM', roomCode }));

    const guestAck = guest.lastFrame();
    expect(guestAck?.['type']).toBe('ROOM_JOINED');
    expect(guestAck?.['roomCode']).toBe(roomCode);
    expect(typeof guestAck?.['peerToken']).toBe('string');
    expect(guestAck?.['iceServers']).toEqual(ICE_SERVERS);

    expect(host.lastType()).toBe('PEER_JOINED');
    expect(server.boundSocketCount).toBe(2);
  });

  it('3. malformed message → ERROR INVALID_MESSAGE，连接仍可用（随后可 CREATE_ROOM）', () => {
    const clock = new FakeClock();
    const { server } = makeServer(clock);
    const socket = new FakeSignalingSocket('s');

    for (const raw of ['', '{not-json', JSON.stringify({ v: 2, type: 'CREATE_ROOM' }), JSON.stringify({ v: 1, type: 'ROOM_CREATED' })]) {
      server.handleMessage(socket, raw);
      const err = socket.lastFrame();
      expect(err?.['type']).toBe('ERROR');
      expect(err?.['code']).toBe('INVALID_MESSAGE');
      socket.clear();
    }

    // 连接未被杀：CREATE_ROOM 照常成功
    server.handleMessage(socket, clientFrame({ type: 'CREATE_ROOM' }));
    expect(socket.lastType()).toBe('ROOM_CREATED');
  });

  it('4. duplicate join：已绑定 socket 再 JOIN / CREATE → ERROR INVALID_MESSAGE（角色不可经由重复动作改写）', () => {
    const clock = new FakeClock();
    const { server, host, roomCode } = makeServerAndHost(clock);
    const guest = new FakeSignalingSocket('guest');
    server.handleMessage(guest, clientFrame({ type: 'JOIN_ROOM', roomCode }));
    guest.clear();

    server.handleMessage(guest, clientFrame({ type: 'JOIN_ROOM', roomCode }));
    expect(guest.lastFrame()?.['code']).toBe('INVALID_MESSAGE');

    server.handleMessage(host, clientFrame({ type: 'CREATE_ROOM' }));
    expect(host.lastFrame()?.['code']).toBe('INVALID_MESSAGE');
  });

  it('5. relay：OFFER host→guest / ANSWER guest→host / ICE_CANDIDATE 双向 / ICE_END', () => {
    const clock = new FakeClock();
    const { server, host, guest, roomCode } = makePairedRoom(clock);

    server.handleMessage(host, clientFrame({ type: 'OFFER', sdp: 'offer-sdp' }));
    expect(guest.lastFrame()).toMatchObject({ type: 'OFFER', sdp: 'offer-sdp' });
    expect(host.sent.length).toBe(0); // 不回声

    server.handleMessage(guest, clientFrame({ type: 'ANSWER', sdp: 'answer-sdp' }));
    expect(host.lastFrame()).toMatchObject({ type: 'ANSWER', sdp: 'answer-sdp' });

    server.handleMessage(host, clientFrame({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:1 1 UDP 1 10.0.0.1 11111 typ host', sdpMid: '0' } }));
    expect(guest.lastFrame()).toMatchObject({ type: 'ICE_CANDIDATE' });

    server.handleMessage(guest, clientFrame({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:2 1 UDP 1 10.0.0.2 22222 typ srflx' } }));
    expect(host.lastFrame()).toMatchObject({ type: 'ICE_CANDIDATE' });

    server.handleMessage(guest, clientFrame({ type: 'ICE_END' }));
    expect(host.lastFrame()).toMatchObject({ type: 'ICE_END' });
    void roomCode;
  });

  it('6. relay 未入房 → ERROR NOT_IN_ROOM', () => {
    const clock = new FakeClock();
    const { server } = makeServer(clock);
    const loner = new FakeSignalingSocket('loner');
    server.handleMessage(loner, clientFrame({ type: 'OFFER', sdp: 'sdp' }));
    expect(loner.lastFrame()).toMatchObject({ type: 'ERROR', code: 'NOT_IN_ROOM' });
  });

  it('7. peer leave：guest 断开 → host 收 PEER_LEFT；此后 host relay 静默丢弃（无接收者）', () => {
    const clock = new FakeClock();
    const { server, host, guest } = makePairedRoom(clock);

    server.handleDisconnect(guest);
    expect(host.lastType()).toBe('PEER_LEFT');

    host.clear();
    server.handleMessage(host, clientFrame({ type: 'OFFER', sdp: 'sdp' }));
    expect(host.sent.length).toBe(0); // 无对端 → 丢弃不回错
  });

  it('8. reconnect identity 端到端：guest 掉线重入（token）→ host 收 PEER_JOINED；host 掉线重入 → guest 收 PEER_JOINED', () => {
    const clock = new FakeClock();
    const { server, host, guest, roomCode, hostToken, guestToken } = makePairedRoom(clock);

    // guest 掉线 → host PEER_LEFT → 新 socket 持 token 重入 → host PEER_JOINED
    server.handleDisconnect(guest);
    expect(host.lastType()).toBe('PEER_LEFT');
    const guestBack = new FakeSignalingSocket('guest-back');
    server.handleMessage(guestBack, clientFrame({ type: 'JOIN_ROOM', roomCode, peerToken: guestToken }));
    expect(guestBack.lastFrame()).toMatchObject({ type: 'ROOM_JOINED', peerToken: guestToken });
    expect(host.lastType()).toBe('PEER_JOINED');

    // host 掉线 → guest PEER_LEFT → 新 socket 持 token 重入 → guest PEER_JOINED
    server.handleDisconnect(host);
    expect(guestBack.lastType()).toBe('PEER_LEFT');
    const hostBack = new FakeSignalingSocket('host-back');
    server.handleMessage(hostBack, clientFrame({ type: 'JOIN_ROOM', roomCode, peerToken: hostToken }));
    expect(hostBack.lastFrame()).toMatchObject({ type: 'ROOM_JOINED', peerToken: hostToken });
    expect(guestBack.lastType()).toBe('PEER_JOINED');
  });

  it('9. 房间隔离：房间 A 的 relay 不达房间 B', () => {
    const clock = new FakeClock();
    const a = makePairedRoom(clock);
    const b = makePairedRoom(clock);

    a.server.handleMessage(a.host, clientFrame({ type: 'OFFER', sdp: 'A-offer' }));
    expect(a.guest.lastFrame()).toMatchObject({ type: 'OFFER', sdp: 'A-offer' });
    expect(b.guest.sent.length).toBe(0);
    expect(b.host.sent.length).toBe(0);
  });

  it('10. join 校验矩阵经分发层：INVALID_ROOM_CODE / ROOM_NOT_FOUND / ROOM_FULL', () => {
    const clock = new FakeClock();
    const { server, roomCode } = makeServerAndHost(clock);
    server.handleMessage(new FakeSignalingSocket('g0'), clientFrame({ type: 'JOIN_ROOM', roomCode }));
    // （配对完成 —— 第三个 socket 将得 ROOM_FULL）

    const bad = new FakeSignalingSocket('bad');
    server.handleMessage(bad, clientFrame({ type: 'JOIN_ROOM', roomCode: 'ABC1EF' })); // 非法字符 1
    expect(bad.lastFrame()).toMatchObject({ type: 'ERROR', code: 'INVALID_ROOM_CODE' });

    const missing = new FakeSignalingSocket('missing');
    server.handleMessage(missing, clientFrame({ type: 'JOIN_ROOM', roomCode: 'ZZZZZ9' }));
    expect(missing.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_NOT_FOUND' });

    const third = new FakeSignalingSocket('third');
    server.handleMessage(third, clientFrame({ type: 'JOIN_ROOM', roomCode }));
    expect(third.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_FULL' });
  });

  it('11. runSweep：waiting 超时 → 在连 host 收 ERROR ROOM_EXPIRED + 解绑（后续消息 → NOT_IN_ROOM）', () => {
    const clock = new FakeClock();
    const { server, host } = makeServerAndHost(clock);

    clock.advance(WAITING_TTL_MS + 1);
    server.runSweep();

    expect(host.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_EXPIRED' });
    expect(server.boundSocketCount).toBe(0);

    host.clear();
    server.handleMessage(host, clientFrame({ type: 'OFFER', sdp: 'sdp' }));
    expect(host.lastFrame()).toMatchObject({ type: 'ERROR', code: 'NOT_IN_ROOM' });
  });

  it('12. 二进制帧由 bootstrap 层丢弃（分发层契约：文本帧之外零处理）—— 空串即 INVALID_MESSAGE', () => {
    const clock = new FakeClock();
    const { server } = makeServer(clock);
    const socket = new FakeSignalingSocket('s');
    server.handleMessage(socket, '   ');
    expect(socket.lastFrame()).toMatchObject({ type: 'ERROR', code: 'INVALID_MESSAGE', message: 'EMPTY' });
  });

  it('JOIN 惰性删除 waiting 房间：Host 同样收到过期、解绑，sweep 不重复通知', () => {
    const clock = new FakeClock();
    const { server, host, roomCode } = makeServerAndHost(clock);
    const lateGuest = new FakeSignalingSocket('late');
    clock.advance(WAITING_TTL_MS + 1);
    server.handleMessage(lateGuest, clientFrame({ type: 'JOIN_ROOM', roomCode }));
    expect(lateGuest.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_EXPIRED', message: 'room expired' });
    expect(host.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_EXPIRED', message: 'room expired' });
    expect(server.boundSocketCount).toBe(0);

    host.clear();
    server.runSweep();
    expect(host.sent).toHaveLength(0);
    server.handleMessage(host, clientFrame({ type: 'CREATE_ROOM' }));
    expect(host.lastType()).toBe('ROOM_CREATED');
    server.handleMessage(lateGuest, clientFrame({ type: 'JOIN_ROOM', roomCode }));
    expect(lateGuest.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_NOT_FOUND' });
  });

  it('JOIN 惰性删除 Host 超 grace 房间：Guest 收 host left 并释放 binding', () => {
    const clock = new FakeClock();
    const { server, host, guest, roomCode, hostToken } = makePairedRoom(clock);
    server.handleDisconnect(host);
    guest.clear();
    clock.advance(SLOT_GRACE_MS + 1);
    const hostBack = new FakeSignalingSocket('host-back');
    server.handleMessage(hostBack, clientFrame({ type: 'JOIN_ROOM', roomCode, peerToken: hostToken }));
    expect(hostBack.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_EXPIRED', message: 'host left' });
    expect(guest.lastFrame()).toMatchObject({ type: 'ERROR', code: 'ROOM_EXPIRED', message: 'host left' });
    expect(server.boundSocketCount).toBe(0);
  });

  it.each(['host', 'guest'] as const)('token 接管 %s：终止旧 socket，旧帧/迟到 close 不干扰新槽', (role) => {
    const clock = new FakeClock();
    const { server, host, guest, roomCode, hostToken, guestToken } = makePairedRoom(clock);
    const old = role === 'host' ? host : guest;
    const peer = role === 'host' ? guest : host;
    let closeCalls = 0;
    // 延迟传输层 close，验证期间旧 socket 仍有排队帧。
    old.close = () => { closeCalls += 1; };
    const replacement = new FakeSignalingSocket('replacement');
    server.handleMessage(replacement, clientFrame({
      type: 'JOIN_ROOM', roomCode, peerToken: role === 'host' ? hostToken : guestToken,
    }));
    expect(closeCalls).toBe(1);
    expect(replacement.lastType()).toBe('ROOM_JOINED');
    expect(peer.frames()).toMatchObject([{ type: 'PEER_JOINED' }]);
    expect(server.boundSocketCount).toBe(2);
    peer.clear();

    server.handleMessage(old, clientFrame({ type: 'OFFER', sdp: 'stale-offer' }));
    expect(old.lastFrame()).toMatchObject({ type: 'ERROR', code: 'NOT_IN_ROOM' });
    expect(peer.sent).toHaveLength(0);
    server.handleDisconnect(old);
    server.handleDisconnect(old);
    expect(server.boundSocketCount).toBe(2);
    expect(peer.sent).toHaveLength(0);
    server.handleMessage(replacement, clientFrame({ type: 'OFFER', sdp: 'live-offer' }));
    expect(peer.lastFrame()).toMatchObject({ type: 'OFFER', sdp: 'live-offer' });
  });
});
