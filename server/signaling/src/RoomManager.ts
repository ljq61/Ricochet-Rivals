import { randomInt, randomUUID } from 'node:crypto';
import {
  isValidRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../../../src/game/network/signaling/RoomCode';
import { SignalingRoom, type RoomDeleteReason } from './SignalingRoom';
import type { RoomRole, SignalingSocket } from './socket';

/**
 * RoomManager（SG-2）—— 房间注册表：创建 / 加入校验 / 断开重连身份 / 过期清扫。
 *
 * 房间码：6 位高可读字符（共享 RoomCode alphabet；排除 0/O/1/I/L），
 * crypto 随机 —— 不可预测（防房间枚举）。碰撞与现存房间重试。
 *
 * joinRoom 语义（返回 notifyPeer 的 socket 由上层发 PEER_JOINED）：
 * * 新 Guest join：guest 槽空闲且 Host 在线 → 绑定 + 新 token。
 * * token resume：JOIN_ROOM 携带 peerToken 匹配槽位 token → 原位恢复，
 *   旧 socket 尚未关闭也可接管（网络黑洞不会及时发 close）；上层终止旧 socket。
 * * 槽位被占用（连接中）→ 无有效 token 的加入得到 ROOM_FULL。
 * * Guest 席位保留期内（断开 < slotGrace）→ 新 join 拒 ROOM_FULL（防挤占）。
 * * Host 断开（槽位空置）→ 新 Guest join 拒 ROOM_EXPIRED（无主房间）；
 *   resume 不受影响。
 * * 房间已死未清扫 → 惰性删除 + ROOM_EXPIRED。
 */

export type JoinErrorCode = 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'ROOM_EXPIRED' | 'INVALID_ROOM_CODE';

export type JoinOutcome =
  | {
      ok: true;
      kind: 'joined' | 'resumed';
      role: RoomRole;
      room: SignalingRoom;
      peerToken: string;
      /** 有效 token 接管尚未释放的旧连接；上层先解绑并终止该 socket。 */
      replacedSocket?: SignalingSocket;
      /** 配对 / 恢复事件的通知对象（对端当前连接 socket；无则 null） */
      notifyPeer: SignalingSocket | null;
    }
  | {
      ok: false;
      code: JoinErrorCode;
      message?: string;
      /** 惰性删除与 sweep 共用上层通知/解绑收口。 */
      deletedRoom?: DeletedRoom;
    };

export interface DeletedRoom {
  readonly room: SignalingRoom;
  readonly reason: RoomDeleteReason;
}

export interface RoomManagerOptions {
  readonly now?: () => number;
  readonly waitingTtlMs?: number;
  readonly slotGraceMs?: number;
  /** 测试注入确定性生成器（缺省 crypto 随机） */
  readonly codeGenerator?: () => string;
  readonly tokenGenerator?: () => string;
}

const CODE_COLLISION_RETRY_LIMIT = 20;

export class RoomManager {
  private readonly rooms = new Map<string, SignalingRoom>();
  private readonly now: () => number;
  private readonly waitingTtlMs: number;
  private readonly slotGraceMs: number;
  private readonly codeGenerator: () => string;
  private readonly tokenGenerator: () => string;

  constructor(options: RoomManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.waitingTtlMs = options.waitingTtlMs ?? 600_000;
    this.slotGraceMs = options.slotGraceMs ?? 30_000;
    this.codeGenerator = options.codeGenerator ?? defaultGenerateRoomCode;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  findRoom(roomCode: string): SignalingRoom | null {
    return this.rooms.get(roomCode) ?? null;
  }

  /** Host 建房：生成房间码（碰撞重试）+ hostToken；Host 槽位即绑 */
  createRoom(hostSocket: SignalingSocket): { room: SignalingRoom; hostToken: string } {
    let roomCode = this.codeGenerator();
    for (let attempt = 0; this.rooms.has(roomCode) && attempt < CODE_COLLISION_RETRY_LIMIT; attempt++) {
      roomCode = this.codeGenerator();
    }
    if (this.rooms.has(roomCode)) {
      // 30^6 ≈ 7.3e8 组合，20 次重试后仍碰撞 = 生成器故障 —— fail loud
      throw new Error(`[RoomManager] room code generation exhausted collision retries: ${roomCode}`);
    }
    const hostToken = this.tokenGenerator();
    const room = new SignalingRoom({
      roomCode,
      hostToken,
      hostSocket,
      now: this.now(),
      waitingTtlMs: this.waitingTtlMs,
    });
    this.rooms.set(roomCode, room);
    return { room, hostToken };
  }

  joinRoom(roomCode: string, peerToken: string | undefined, socket: SignalingSocket): JoinOutcome {
    if (!isValidRoomCode(roomCode)) {
      return { ok: false, code: 'INVALID_ROOM_CODE', message: `malformed room code: '${roomCode}'` };
    }
    const room = this.rooms.get(roomCode);
    if (room === undefined) {
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }

    const now = this.now();
    // 已死未清扫 → 惰性删除（下一次同码 join 即 ROOM_NOT_FOUND）
    const dead = room.deleteReason(now, this.slotGraceMs);
    if (dead !== null) {
      this.rooms.delete(roomCode);
      return {
        ok: false,
        code: 'ROOM_EXPIRED',
        message: dead === 'waiting-expired' ? 'room expired' : 'host left',
        deletedRoom: { room, reason: dead },
      };
    }

    // Host resume：token 匹配 host 槽
    if (peerToken !== undefined && peerToken === room.hostToken) {
      const replacedSocket = room.attachHost(socket);
      return {
        ok: true,
        kind: 'resumed',
        role: 'host',
        room,
        peerToken,
        replacedSocket: replacedSocket ?? undefined,
        notifyPeer: room.peerOf(socket),
      };
    }

    // Guest resume：token 匹配 guest 槽
    if (peerToken !== undefined && peerToken === room.guestToken) {
      const replacedSocket = room.reattachGuest(socket);
      return {
        ok: true,
        kind: 'resumed',
        role: 'guest',
        room,
        peerToken,
        replacedSocket: replacedSocket ?? undefined,
        notifyPeer: room.peerOf(socket),
      };
    }

    // 新 Guest join：guest 槽不得被占（连接中或断开保留期内）
    if (room.guestConnected || room.guestWithinGrace(now, this.slotGraceMs)) {
      return { ok: false, code: 'ROOM_FULL', message: 'room is full' };
    }
    // 房间锚点已失（Host 断开，保留期内等待 resume）—— 新 join 拒绝
    if (!room.hostConnected) {
      return { ok: false, code: 'ROOM_EXPIRED', message: 'host disconnected' };
    }
    const guestToken = this.tokenGenerator();
    room.attachGuest(socket, guestToken);
    return {
      ok: true,
      kind: 'joined',
      role: 'guest',
      room,
      peerToken: guestToken,
      notifyPeer: room.peerOf(socket),
    };
  }

  /**
   * 过期清扫：释放超保留期的断开 guest 槽，删除死亡房间。
   * 返回被删房间（上层负责解绑 boundSockets + 发 ERROR 通知）。
   */
  sweep(): DeletedRoom[] {
    const now = this.now();
    const deleted: DeletedRoom[] = [];
    for (const [roomCode, room] of this.rooms) {
      room.releaseStaleGuestSlot(now, this.slotGraceMs);
      const reason = room.deleteReason(now, this.slotGraceMs);
      if (reason !== null) {
        this.rooms.delete(roomCode);
        deleted.push({ room, reason });
      }
    }
    return deleted;
  }
}

/** crypto 随机房间码（不可预测 —— 防枚举；alphabet 无正则元字符，charAt 越界返回空串恒安全） */
function defaultGenerateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(0, ROOM_CODE_ALPHABET.length));
  }
  return code;
}
