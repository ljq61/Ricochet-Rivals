import type { RoomRole, SignalingSocket } from './socket';

/**
 * SignalingRoom（SG-2）—— 房间实体：Host/Guest 双槽位 + 断开保留期。
 *
 * 角色语义（迁移规格）：CREATE_ROOM 的 socket = Host = P1（房间锚点，
 * Host Authoritative 架构下 Host 离开即房间终局）；JOIN_ROOM 的 socket =
 * Guest = P2。协议中不存在角色声明 —— 本类只按槽位寻址转发。
 *
 * 生命周期：
 * * waiting 截止（expiresAt）：从未有 Guest 绑定（guestSlot === null）且超时
 *   → sweep 删除；Guest 一旦绑定过（含断开保留期），waiting 过期不再适用
 *   —— 房间存续由 socket 存续决定。
 * * Host 断开：slotGrace 内可持 hostToken 恢复；超窗 → sweep 删除
 *   （Guest 已在断开瞬间收 PEER_LEFT）。
 * * Guest 断开：slotGrace 内可持 guestToken 恢复（席位保留，新 join 得
 *   ROOM_FULL）；超窗 → 槽释放，Host 可接新 Guest（新 token）。
 */
export type RoomDeleteReason = 'waiting-expired' | 'host-grace-elapsed';

interface PeerSlot {
  readonly token: string;
  socket: SignalingSocket | null;
  disconnectedAt: number | null;
}

export class SignalingRoom {
  readonly roomCode: string;
  readonly createdAt: number;
  /** waiting 截止（createdAt + waitingTtlMs）；Guest 绑定过即不再适用 */
  readonly expiresAt: number;

  private hostSlot: PeerSlot;
  private guestSlotValue: PeerSlot | null = null;

  constructor(options: {
    readonly roomCode: string;
    readonly hostToken: string;
    readonly hostSocket: SignalingSocket;
    readonly now: number;
    readonly waitingTtlMs: number;
  }) {
    this.roomCode = options.roomCode;
    this.createdAt = options.now;
    this.expiresAt = options.now + options.waitingTtlMs;
    this.hostSlot = { token: options.hostToken, socket: options.hostSocket, disconnectedAt: null };
  }

  get hostToken(): string {
    return this.hostSlot.token;
  }

  get guestToken(): string | null {
    return this.guestSlotValue?.token ?? null;
  }

  get hostConnected(): boolean {
    return this.hostSlot.socket !== null;
  }

  get guestConnected(): boolean {
    return this.guestSlotValue?.socket != null;
  }

  /** 当前连接中 socket 的角色归属（未连接 / 非本房间 → null） */
  roleOf(socket: SignalingSocket): RoomRole | null {
    if (this.hostSlot.socket === socket) {
      return 'host';
    }
    if (this.guestSlotValue?.socket === socket) {
      return 'guest';
    }
    return null;
  }

  /** host 槽位空置（socket 断开，token 保留 —— 可 resume） */
  hostSlotVacant(): boolean {
    return this.hostSlot.socket === null;
  }

  /** guest 断开后是否仍在保留期内（席位保留 → 新 join 拒为 ROOM_FULL） */
  guestWithinGrace(now: number, graceMs: number): boolean {
    const slot = this.guestSlotValue;
    if (slot === null || slot.socket !== null || slot.disconnectedAt === null) {
      return false;
    }
    return now - slot.disconnectedAt <= graceMs;
  }

  /** Host resume：重绑 socket（token 不变） */
  attachHost(socket: SignalingSocket): SignalingSocket | null {
    const previous = this.hostSlot.socket;
    this.hostSlot = { token: this.hostSlot.token, socket, disconnectedAt: null };
    return previous;
  }

  /** 新 Guest 绑定（token 由 RoomManager 生成） */
  attachGuest(socket: SignalingSocket, token: string): void {
    this.guestSlotValue = { token, socket, disconnectedAt: null };
  }

  /** Guest resume：重绑 socket（沿用原 token） */
  reattachGuest(socket: SignalingSocket): SignalingSocket | null {
    const slot = this.guestSlotValue;
    if (slot === null) {
      throw new Error(`[SignalingRoom] reattachGuest without guest slot: ${this.roomCode}`);
    }
    this.guestSlotValue = { token: slot.token, socket, disconnectedAt: null };
    return slot.socket;
  }

  /**
   * socket 断开：标记槽位（token 保留至保留期）；返回其角色（未连接 → null，
   * 幂等 —— 重复 close / sweep 后 close 不二次标记）。
   */
  detach(socket: SignalingSocket, now: number): RoomRole | null {
    if (this.hostSlot.socket === socket) {
      this.hostSlot = { token: this.hostSlot.token, socket: null, disconnectedAt: now };
      return 'host';
    }
    if (this.guestSlotValue?.socket === socket) {
      this.guestSlotValue = {
        token: this.guestSlotValue.token,
        socket: null,
        disconnectedAt: now,
      };
      return 'guest';
    }
    return null;
  }

  /** 转发目标：from socket 的当前连接对端（无 → null） */
  peerOf(socket: SignalingSocket): SignalingSocket | null {
    if (this.hostSlot.socket === socket) {
      return this.guestSlotValue?.socket ?? null;
    }
    if (this.guestSlotValue?.socket === socket) {
      return this.hostSlot.socket;
    }
    return null;
  }

  /** 释放超保留期的断开 guest 槽（Host 可接新 Guest） */
  releaseStaleGuestSlot(now: number, graceMs: number): void {
    const slot = this.guestSlotValue;
    if (
      slot !== null &&
      slot.socket === null &&
      slot.disconnectedAt !== null &&
      now - slot.disconnectedAt > graceMs
    ) {
      this.guestSlotValue = null;
    }
  }

  /**
   * 房间删除判定（sweep / join 时惰性检查用）：
   * * waiting-expired —— 从未配对且超 waiting TTL
   * * host-grace-elapsed —— Host 断开超保留期（房间锚点已失）
   */
  deleteReason(now: number, slotGraceMs: number): RoomDeleteReason | null {
    if (this.guestSlotValue === null && now > this.expiresAt) {
      return 'waiting-expired';
    }
    const hostDownSince = this.hostSlot.socket === null ? this.hostSlot.disconnectedAt : null;
    if (hostDownSince !== null && now - hostDownSince > slotGraceMs) {
      return 'host-grace-elapsed';
    }
    return null;
  }

  /** 当前连接中的 sockets（房间删除时上层解绑 / 通知用） */
  boundSockets(): SignalingSocket[] {
    const sockets: SignalingSocket[] = [];
    if (this.hostSlot.socket !== null) {
      sockets.push(this.hostSlot.socket);
    }
    if (this.guestSlotValue?.socket != null) {
      sockets.push(this.guestSlotValue.socket);
    }
    return sockets;
  }
}
