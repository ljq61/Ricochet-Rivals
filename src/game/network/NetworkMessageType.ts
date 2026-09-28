/**
 * 网络消息类型全集（Phase 12 协议层，TASKS.md Core TypeScript Contracts）。
 *
 * * PING/PONG —— 连接保活 / RTT 测量（Phase 13 使用，本阶段仅定义）。
 * * 其余与 Phase 14 命令同步一一对应（HOST AUTHORITATIVE：
 *   *_REQUEST 由 Guest 上报，Host 校验后广播权威版本）。
 *
 * wire 兼容防线：值即协议 —— 改动任何值都是破坏性协议变更，
 * 必须递增 NetworkEnvelope.version（tests/network/NetworkContracts 锁定）。
 */
export enum NetworkMessageType {
  PING = 'PING',
  PONG = 'PONG',
  PLAYER_READY = 'PLAYER_READY',
  GAME_START = 'GAME_START',
  MOVE_REQUEST = 'MOVE_REQUEST',
  MOVE = 'MOVE',
  FIRE_REQUEST = 'FIRE_REQUEST',
  FIRE = 'FIRE',
  TURN_RESULT = 'TURN_RESULT',
  TURN_END = 'TURN_END',
  STATE_SYNC_REQUEST = 'STATE_SYNC_REQUEST',
  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  REMATCH = 'REMATCH',
  DISCONNECT = 'DISCONNECT',
}
