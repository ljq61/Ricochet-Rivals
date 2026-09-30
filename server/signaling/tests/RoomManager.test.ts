import { describe, expect, it } from 'vitest';
import { RoomManager } from '../src/RoomManager';
import { FakeClock, FakeSignalingSocket } from './signalingFakes';
import { isValidRoomCode } from '../../../src/game/network/signaling/RoomCode';

/**
 * RoomManager（SG-2）—— 房间注册表：创建 / 加入校验 / reconnect identity / 清扫。
 * 规格（Online Connection Migration）测试矩阵的服务侧半边。
 */

const WAITING_TTL_MS = 600_000;
const SLOT_GRACE_MS = 30_000;

function makeManager(clock: FakeClock): RoomManager {
  return new RoomManager({
    now: () => clock.current(),
    waitingTtlMs: WAITING_TTL_MS,
    slotGraceMs: SLOT_GRACE_MS,
  });
}

describe('RoomManager', () => {
  it('1. create room：合法 6 位码 + hostToken + waiting 截止 + crypto 路径 200 次无重复', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room, hostToken } = manager.createRoom(host);

    expect(isValidRoomCode(room.roomCode)).toBe(true);
    expect(typeof hostToken).toBe('string');
    expect(hostToken.length).toBeGreaterThan(0);
    expect(room.expiresAt).toBe(clock.current() + WAITING_TTL_MS);
    expect(room.hostToken).toBe(hostToken);
    expect(manager.roomCount).toBe(1);

    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { room: r } = manager.createRoom(new FakeSignalingSocket());
      expect(isValidRoomCode(r.roomCode)).toBe(true);
      codes.add(r.roomCode);
    }
    expect(codes.size).toBe(200);
  });

  it('2. create room：房间码与现存房间碰撞 → 生成器重试', () => {
    const clock = new FakeClock();
    const codes = ['AAAAAA', 'AAAAAA', 'BBBBBB'];
    let index = 0;
    const manager = new RoomManager({
      now: () => clock.current(),
      codeGenerator: () => codes[index++] ?? 'CCCCCC',
    });
    const first = manager.createRoom(new FakeSignalingSocket('h1'));
    expect(first.room.roomCode).toBe('AAAAAA');
    const second = manager.createRoom(new FakeSignalingSocket('h2'));
    expect(second.room.roomCode).toBe('BBBBBB');
  });

  it('3. join room：新 guest 绑定 + 新 token + notifyPeer = host', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room } = manager.createRoom(host);
    const guest = new FakeSignalingSocket('guest');

    const outcome = manager.joinRoom(room.roomCode, undefined, guest);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe('joined');
    expect(outcome.role).toBe('guest');
    expect(typeof outcome.peerToken).toBe('string');
    expect(outcome.room).toBe(room);
    expect(outcome.notifyPeer).toBe(host);
    expect(room.guestToken).toBe(outcome.peerToken);
  });

  it('4. invalid room：格式非法 → INVALID_ROOM_CODE；格式合法但不存在 → ROOM_NOT_FOUND', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const guest = new FakeSignalingSocket('guest');

    const malformed = manager.joinRoom('BAD1', undefined, guest); // 含非法字符 1
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.code).toBe('INVALID_ROOM_CODE');

    const unknown = manager.joinRoom('ZZZZZ9', undefined, guest); // 合法格式、未建
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.code).toBe('ROOM_NOT_FOUND');
  });

  it('5. room full：guest 连接中 → 第三 socket join → ROOM_FULL', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room } = manager.createRoom(host);
    manager.joinRoom(room.roomCode, undefined, new FakeSignalingSocket('guest'));

    const third = manager.joinRoom(room.roomCode, undefined, new FakeSignalingSocket('third'));
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.code).toBe('ROOM_FULL');
  });

  it('6. room expiry：超 waiting TTL → join 得 ROOM_EXPIRED + 惰性删除（再 join → ROOM_NOT_FOUND）', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room } = manager.createRoom(host);

    clock.advance(WAITING_TTL_MS + 1);
    const outcome = manager.joinRoom(room.roomCode, undefined, new FakeSignalingSocket('late'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('ROOM_EXPIRED');
    expect(manager.roomCount).toBe(0);

    const again = manager.joinRoom(room.roomCode, undefined, new FakeSignalingSocket('again'));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('ROOM_NOT_FOUND');
  });

  it('7. sweep：waiting 超时房间删除（boundSockets 含在连 host）；存活房间不受影响', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const hostA = new FakeSignalingSocket('hostA');
    const expired = manager.createRoom(hostA);
    clock.advance(60_000); // B 房晚 60s 建 → 不会被同一次清扫命中
    manager.createRoom(new FakeSignalingSocket('hostB'));

    // 只越过 A 的 waiting 截止（t = 60s + 540.001s = 600.001s > A 的 600s；
    // B 的截止在 660s，仍余 ~60s）
    clock.advance(WAITING_TTL_MS - 60_000 + 1);
    const deleted = manager.sweep();

    expect(deleted.length).toBe(1);
    expect(deleted[0]?.room).toBe(expired.room);
    expect(deleted[0]?.reason).toBe('waiting-expired');
    expect(expired.room.boundSockets()).toEqual([hostA]);
    expect(manager.roomCount).toBe(1);
    expect(manager.findRoom(expired.room.roomCode)).toBeNull();
  });

  it('8. peer leave + 席位保留：grace 内新 join → ROOM_FULL；超窗释放 → 新 guest 顶替（新 token）', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room } = manager.createRoom(host);
    const guest = new FakeSignalingSocket('guest');
    const joined = manager.joinRoom(room.roomCode, undefined, guest);
    if (!joined.ok) throw new Error('setup join failed');
    const oldGuestToken = joined.peerToken;

    // guest 断开（服务器经 room.detach 标记）→ 对端应获 PEER_LEFT（server 层测）
    room.detach(guest, clock.current());

    // grace 内：席位保留 → 新 join 拒；原 token resume 可用
    const newcomer = manager.joinRoom(room.roomCode, undefined, new FakeSignalingSocket('new'));
    expect(newcomer.ok).toBe(false);
    if (newcomer.ok) return;
    expect(newcomer.code).toBe('ROOM_FULL');
    const guestBack = new FakeSignalingSocket('back');
    const resumed = manager.joinRoom(room.roomCode, oldGuestToken, guestBack);
    expect(resumed.ok).toBe(true);
    expect(room.guestToken).toBe(oldGuestToken); // resume 沿用原 token

    // 重连后再断开，超 grace → sweep 释放席位 → 新 guest 以新 token 加入
    room.detach(guestBack, clock.current());
    clock.advance(SLOT_GRACE_MS + 1);
    manager.sweep();
    const fresh = manager.joinRoom(room.roomCode, undefined, new FakeSignalingSocket('fresh'));
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.kind).toBe('joined');
    expect(fresh.peerToken).not.toBe(oldGuestToken);
  });

  it('9. reconnect identity：guest / host token 原位恢复（notifyPeer = 在连对端）', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room, hostToken } = manager.createRoom(host);
    const guest = new FakeSignalingSocket('guest');
    const joined = manager.joinRoom(room.roomCode, undefined, guest);
    if (!joined.ok) throw new Error('setup join failed');

    // guest 断开 → 新 socket 持 token 重入
    room.detach(guest, clock.current());
    const guestBack = new FakeSignalingSocket('guest-back');
    const guestResume = manager.joinRoom(room.roomCode, joined.peerToken, guestBack);
    expect(guestResume.ok).toBe(true);
    if (!guestResume.ok) return;
    expect(guestResume.kind).toBe('resumed');
    expect(guestResume.role).toBe('guest');
    expect(guestResume.peerToken).toBe(joined.peerToken);
    expect(guestResume.notifyPeer).toBe(host);

    // host 断开 → 新 socket 持 token 重入（notifyPeer = guest）
    room.detach(host, clock.current());
    const hostBack = new FakeSignalingSocket('host-back');
    const hostResume = manager.joinRoom(room.roomCode, hostToken, hostBack);
    expect(hostResume.ok).toBe(true);
    if (!hostResume.ok) return;
    expect(hostResume.kind).toBe('resumed');
    expect(hostResume.role).toBe('host');
    expect(hostResume.notifyPeer).toBe(guestBack);
  });

  it('10. 有效 token 可接管半开原槽；无效 token 不能挤占已配对房间', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room, hostToken } = manager.createRoom(host);
    const guest = new FakeSignalingSocket('guest');
    const joined = manager.joinRoom(room.roomCode, undefined, guest);
    if (!joined.ok) throw new Error('setup join failed');

    const attacker = manager.joinRoom(room.roomCode, 'wrong-token', new FakeSignalingSocket('a'));
    expect(attacker).toMatchObject({ ok: false, code: 'ROOM_FULL' });

    const hostBack = new FakeSignalingSocket('h2');
    const hostClaim = manager.joinRoom(room.roomCode, hostToken, hostBack);
    expect(hostClaim).toMatchObject({ ok: true, kind: 'resumed', role: 'host', peerToken: hostToken });
    if (!hostClaim.ok) return;
    expect(hostClaim.replacedSocket).toBe(host);
    expect(room.roleOf(host)).toBeNull();
    expect(room.roleOf(hostBack)).toBe('host');

    const guestBack = new FakeSignalingSocket('g2');
    const guestClaim = manager.joinRoom(room.roomCode, joined.peerToken, guestBack);
    expect(guestClaim).toMatchObject({ ok: true, kind: 'resumed', role: 'guest', peerToken: joined.peerToken });
    if (!guestClaim.ok) return;
    expect(guestClaim.replacedSocket).toBe(guest);
    expect(room.roleOf(guest)).toBeNull();
    expect(room.roleOf(guestBack)).toBe('guest');
  });

  it('11. host 断开：grace 内新 guest join → ROOM_EXPIRED（无主房间）；host 超窗未归 → sweep 删房', () => {
    const clock = new FakeClock();
    const manager = makeManager(clock);
    const host = new FakeSignalingSocket('host');
    const { room, hostToken } = manager.createRoom(host);
    room.detach(host, clock.current());

    // grace 内：新 guest 不得入无主房间
    const newcomer = manager.joinRoom(room.roomCode, undefined, new FakeSignalingSocket('n'));
    expect(newcomer.ok).toBe(false);
    if (newcomer.ok) return;
    expect(newcomer.code).toBe('ROOM_EXPIRED');

    // 超窗 → sweep 删除（host-grace-elapsed）
    clock.advance(SLOT_GRACE_MS + 1);
    const deleted = manager.sweep();
    expect(deleted.length).toBe(1);
    expect(deleted[0]?.reason).toBe('host-grace-elapsed');
    expect(manager.roomCount).toBe(0);
    void hostToken;
  });
});
