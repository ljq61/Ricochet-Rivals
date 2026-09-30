/**
 * SignalingSocket（SG-2）—— 服务器视角的最小 socket surface。
 *
 * ws 适配器（bootstrap.ts）实现；单测注入 Fake。消费方（SignalingRoomServer /
 * SignalingRoom / RoomManager）只依赖本接口 —— 协议逻辑与传输层解耦。
 */
export interface SignalingSocket {
  /** 连接唯一标识（crypto.randomUUID；绑定表 key + 日志） */
  readonly id: string;
  send(data: string): void;
  close(): void;
}

/** 房间角色 —— 由动作固化（CREATE_ROOM = host / JOIN_ROOM = guest），禁止声明 */
export type RoomRole = 'host' | 'guest';
