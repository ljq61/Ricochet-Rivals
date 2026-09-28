import type { PlayerId } from '../state/ids';
import type { NetworkEnvelope } from './NetworkEnvelope';
import { NetworkMessageType } from './NetworkMessageType';

/** validateEnvelope 产生的字段级拒绝原因 */
export type EnvelopeRejectReason =
  | 'NOT_OBJECT'
  | 'MISSING_FIELD'
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'INVALID_MATCH_ID'
  | 'INVALID_TURN_ID'
  | 'INVALID_SENDER_ID'
  | 'INVALID_SEQUENCE'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_PAYLOAD';

/** 协议层拒绝原因全集（INVALID_JSON 仅由 NetworkSerializer 产生） */
export type NetworkRejectReason = EnvelopeRejectReason | 'INVALID_JSON';

/**
 * 受控协议错误：机器可读 reason + 人可读 message。
 *
 * 双轨使用（同一错误税制，Phase 12 设计决策）：
 * * validateEnvelope 对非法输入 throw 本错误 —— 内部边界断言，失败即调用方 bug；
 * * NetworkSerializer.deserializeEnvelope 以 Result 形态返回本错误实例 ——
 *   网络收到垃圾是预期输入，调用方按 ok 判别分流，无需 try/catch。
 */
export class NetworkProtocolError extends Error {
  readonly reason: NetworkRejectReason;

  constructor(reason: NetworkRejectReason, message: string) {
    super(message);
    this.name = 'NetworkProtocolError';
    this.reason = reason;
  }
}

/** 全部合法消息类型值（wire 白名单） */
const KNOWN_MESSAGE_TYPES: ReadonlySet<string> = new Set<string>(
  Object.values(NetworkMessageType),
);

/** envelope 字段按此固定顺序做存在性检查（错误信息确定性） */
const ENVELOPE_FIELDS = [
  'version',
  'type',
  'matchId',
  'turnId',
  'senderId',
  'sequence',
  'timestamp',
  'payload',
] as const;

function isPlayerId(value: unknown): value is PlayerId {
  return value === 'P1' || value === 'P2';
}

function isNetworkMessageType(value: unknown): value is NetworkMessageType {
  return typeof value === 'string' && KNOWN_MESSAGE_TYPES.has(value);
}

/** 错误信息中的值描述（字符串加引号、聚合类型降维） */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return String(value);
}

/**
 * Untrusted Input 防线：把任意来源的 unknown 收敛为可信 NetworkEnvelope。
 *
 * 通过则返回**规范化副本**（固定字段集与字段序、丢弃未知字段、payload 保持
 * 浅引用）—— 不修改、不信任入参对象，绝不用 as 直接断言放行。
 * 非法输入 throw NetworkProtocolError（reason 定位到具体字段）。
 */
export function validateEnvelope(raw: unknown): NetworkEnvelope {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new NetworkProtocolError(
      'NOT_OBJECT',
      `envelope must be a plain object (got ${describeValue(raw)})`,
    );
  }
  for (const field of ENVELOPE_FIELDS) {
    if (!(field in raw)) {
      throw new NetworkProtocolError('MISSING_FIELD', `missing required envelope field: "${field}"`);
    }
  }
  const candidate = raw as Record<string, unknown>;

  if (candidate.version !== 1) {
    throw new NetworkProtocolError(
      'UNSUPPORTED_VERSION',
      `unsupported envelope version: ${describeValue(candidate.version)} (expected 1)`,
    );
  }
  const type = candidate.type;
  if (!isNetworkMessageType(type)) {
    throw new NetworkProtocolError('UNKNOWN_MESSAGE_TYPE', `unknown message type: ${describeValue(type)}`);
  }
  const matchId = candidate.matchId;
  if (typeof matchId !== 'string' || matchId.length === 0) {
    throw new NetworkProtocolError(
      'INVALID_MATCH_ID',
      `matchId must be a non-empty string (got ${describeValue(matchId)})`,
    );
  }
  const turnId = candidate.turnId;
  if (typeof turnId !== 'number' || !Number.isInteger(turnId)) {
    throw new NetworkProtocolError('INVALID_TURN_ID', `turnId must be an integer (got ${describeValue(turnId)})`);
  }
  const senderId = candidate.senderId;
  if (!isPlayerId(senderId)) {
    throw new NetworkProtocolError(
      'INVALID_SENDER_ID',
      `senderId must be "P1" or "P2" (got ${describeValue(senderId)})`,
    );
  }
  const sequence = candidate.sequence;
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) {
    throw new NetworkProtocolError(
      'INVALID_SEQUENCE',
      `sequence must be an integer >= 0 (got ${describeValue(sequence)})`,
    );
  }
  const timestamp = candidate.timestamp;
  if (typeof timestamp !== 'number' || !Number.isInteger(timestamp)) {
    throw new NetworkProtocolError(
      'INVALID_TIMESTAMP',
      `timestamp must be an integer (got ${describeValue(timestamp)})`,
    );
  }
  const payload = candidate.payload;
  if (payload === undefined) {
    throw new NetworkProtocolError(
      'INVALID_PAYLOAD',
      'payload must be present and not undefined (null is the explicit "no payload" marker)',
    );
  }

  return {
    version: 1,
    type,
    matchId,
    turnId,
    senderId,
    sequence,
    timestamp,
    payload,
  };
}
