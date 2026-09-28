import type { MatchId, PlayerId, TurnId } from '../state/ids';
import type { NetworkMessageType } from './NetworkMessageType';

/**
 * 网络消息统一封装（TASKS.md Core TypeScript Contracts）。
 *
 * * version 固定 1 —— 协议不兼容演进时递增，旧版本由 validateEnvelope 拒绝。
 * * sequence 由发送方自增（从 0 起）；去重 / 排序 / 重放防护由消费方
 *   （NetworkManager，Phase 12 委托②）负责，Transport 不解释该字段。
 * * payload 必须存在且非 undefined（null 合法 = 显式无载荷）——
 *   JSON.stringify 会静默丢弃 undefined 属性，故在 validateEnvelope 拒之门外。
 *   payload 深层可序列化性（循环引用 / 函数）由各消息的 payload schema 保证。
 */
export interface NetworkEnvelope<T = unknown> {
  readonly version: 1;
  readonly type: NetworkMessageType;
  readonly matchId: MatchId;
  readonly turnId: TurnId;
  readonly senderId: PlayerId;
  readonly sequence: number;
  /** 消息产生时刻（epoch ms 整数） */
  readonly timestamp: number;
  readonly payload: T;
}
