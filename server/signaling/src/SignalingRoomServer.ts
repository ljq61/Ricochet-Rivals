import {
  decodeSignalingOutboundMessage,
  encodeSignalingInboundMessage,
  type SignalingIceServer,
  type SignalingInboundMessage,
  type SignalingOutboundMessage,
} from '../../../src/game/network/signaling/SignalingMessage';
import type { RoomManager } from './RoomManager';
import type { SignalingRoom } from './SignalingRoom';
import type { RoomRole, SignalingSocket } from './socket';

/**
 * SignalingRoomServer（SG-2）—— 消息分发核心：socket↔room 绑定 + 协议处理。
 *
 * 只处理 SignalingMessage（连接协议）—— 不 import NetworkEnvelope，
 * 不接触 GameCommand / GameState（架构红线）。
 *
 * 分发语义：
 * * 帧解码失败 → ERROR INVALID_MESSAGE（连接保持 —— 恢复型客户端可用）。
 * * CREATE_ROOM / JOIN_ROOM：已绑定 socket 再发 → ERROR INVALID_MESSAGE
 *   （duplicate join 防线；也阻断绑定内建新房间夺角色）。
 * * join 成功（新配对 / token 恢复）→ 本端 ROOM_JOINED ack + 对端 PEER_JOINED。
 * * OFFER/ANSWER/ICE_CANDIDATE/ICE_END：未入房 → ERROR NOT_IN_ROOM；
 *   对端不在 → 静默丢弃（竞争窗口：PEER_LEFT 已通知，debug 记录）。
 * * 断开 → 房间槽位标记 + 对端 PEER_LEFT。
 * * runSweep()：过期房间删除 + 全部绑定 socket 解绑 + ERROR ROOM_EXPIRED。
 */

interface SocketBinding {
  readonly room: SignalingRoom;
  readonly role: RoomRole;
}

export interface SignalingRoomServerOptions {
  readonly manager: RoomManager;
  readonly iceServers: SignalingIceServer[];
  readonly now?: () => number;
}

export class SignalingRoomServer {
  private readonly manager: RoomManager;
  private readonly iceServers: SignalingIceServer[];
  private readonly now: () => number;
  private readonly bindings = new Map<SignalingSocket, SocketBinding>();

  constructor(options: SignalingRoomServerOptions) {
    this.manager = options.manager;
    this.iceServers = options.iceServers;
    this.now = options.now ?? Date.now;
  }

  /** 诊断 / 测试：当前绑定 socket 数 */
  get boundSocketCount(): number {
    return this.bindings.size;
  }

  /** 连接建立（无状态 —— 绑定在 CREATE/JOIN 时发生；预留 hook） */
  handleConnect(_socket: SignalingSocket): void {
    // 预留：连接即认证 / 限流（本阶段 YAGNI）
  }

  handleDisconnect(socket: SignalingSocket): void {
    const binding = this.bindings.get(socket);
    if (binding === undefined) {
      return; // 未入房或已被 sweep 解绑 —— 幂等
    }
    this.bindings.delete(socket);
    // 对端解析必须在 detach 之前 —— detach 后本 socket 不再挂在槽位上，
    // peerOf 将无从定位对端（PEER_LEFT 曾因此永不发出）
    const peer = binding.room.peerOf(socket);
    const role = binding.room.detach(socket, this.now());
    if (role !== null && peer !== null) {
      peer.send(encodeSignalingInboundMessage({ type: 'PEER_LEFT' }));
    }
  }

  handleMessage(socket: SignalingSocket, raw: string): void {
    const decoded = decodeSignalingOutboundMessage(raw);
    if (!decoded.ok) {
      this.sendError(
        socket,
        'INVALID_MESSAGE',
        `${decoded.reason}${decoded.detail !== undefined ? `:${decoded.detail}` : ''}`,
      );
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case 'CREATE_ROOM': {
        if (this.bindings.has(socket)) {
          this.sendError(socket, 'INVALID_MESSAGE', 'already in room');
          return;
        }
        const { room, hostToken } = this.manager.createRoom(socket);
        this.bindings.set(socket, { room, role: 'host' });
        this.sendRoomAck(socket, 'ROOM_CREATED', room, hostToken);
        return;
      }
      case 'JOIN_ROOM': {
        if (this.bindings.has(socket)) {
          this.sendError(socket, 'INVALID_MESSAGE', 'already in room');
          return;
        }
        const outcome = this.manager.joinRoom(message.roomCode, message.peerToken, socket);
        if (!outcome.ok) {
          this.sendError(socket, outcome.code, outcome.message);
          return;
        }
        this.bindings.set(socket, { room: outcome.room, role: outcome.role });
        this.sendRoomAck(socket, 'ROOM_JOINED', outcome.room, outcome.peerToken);
        if (outcome.notifyPeer !== null) {
          outcome.notifyPeer.send(encodeSignalingInboundMessage({ type: 'PEER_JOINED' }));
        }
        return;
      }
      case 'OFFER':
      case 'ANSWER':
      case 'ICE_CANDIDATE':
      case 'ICE_END': {
        const binding = this.bindings.get(socket);
        if (binding === undefined) {
          this.sendError(socket, 'NOT_IN_ROOM');
          return;
        }
        const peer = binding.room.peerOf(socket);
        if (peer === null) {
          console.debug(`[SignalingRoomServer] relay dropped (peer gone): ${message.type}`);
          return;
        }
        peer.send(encodeSignalingInboundMessage(toRelayInbound(message)));
        return;
      }
    }
  }

  /** 周期清扫（bootstrap 定时驱动；测试手动调用）：删房 + 解绑 + 通知 */
  runSweep(): void {
    for (const { room, reason } of this.manager.sweep()) {
      for (const socket of room.boundSockets()) {
        this.bindings.delete(socket);
        this.sendError(
          socket,
          'ROOM_EXPIRED',
          reason === 'waiting-expired' ? 'room expired' : 'host left',
        );
      }
    }
  }

  // ---- 内部 ----

  private sendRoomAck(
    socket: SignalingSocket,
    type: 'ROOM_CREATED' | 'ROOM_JOINED',
    room: SignalingRoom,
    peerToken: string,
  ): void {
    socket.send(
      encodeSignalingInboundMessage({
        type,
        roomCode: room.roomCode,
        peerToken,
        iceServers: this.iceServers,
        expiresAt: room.expiresAt,
      }),
    );
  }

  private sendError(socket: SignalingSocket, code: string, message?: string): void {
    const payload: SignalingInboundMessage =
      message === undefined
        ? { type: 'ERROR', code }
        : { type: 'ERROR', code, message };
    try {
      socket.send(encodeSignalingInboundMessage(payload));
    } catch (error) {
      // 通知目标已死（发送即抛）—— 丢弃即可，断开事件随后收口
      console.debug('[SignalingRoomServer] error notify send failed:', error);
    }
  }
}

/** Client→Server 帧同形转 Server→Client 转发帧（字段经共享 decode 校验） */
function toRelayInbound(message: SignalingOutboundMessage): SignalingInboundMessage {
  switch (message.type) {
    case 'OFFER':
      return { type: 'OFFER', sdp: message.sdp };
    case 'ANSWER':
      return { type: 'ANSWER', sdp: message.sdp };
    case 'ICE_CANDIDATE':
      return { type: 'ICE_CANDIDATE', candidate: message.candidate };
    case 'ICE_END':
      return { type: 'ICE_END' };
    default:
      // CREATE_ROOM / JOIN_ROOM 已在 handleMessage 分支处理 —— 不可达
      throw new Error(`[SignalingRoomServer] unexpected relay type: ${message.type}`);
  }
}
