import { describe, expect, it } from 'vitest';
import {
  NetworkProtocolError,
  validateEnvelope,
  type EnvelopeRejectReason,
} from '../../src/game/network/NetworkProtocol';
import { makeEnvelope } from './envelopeFixture';

const ENVELOPE_FIELD_NAMES = [
  'version',
  'type',
  'matchId',
  'turnId',
  'senderId',
  'sequence',
  'timestamp',
  'payload',
] as const;

function expectReject(raw: unknown, reason: EnvelopeRejectReason, messageIncludes?: string): void {
  let caught: unknown;
  try {
    validateEnvelope(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected validateEnvelope to reject, input: ${JSON.stringify(raw)}`).toBeInstanceOf(
    NetworkProtocolError,
  );
  const err = caught as NetworkProtocolError;
  expect(err.reason).toBe(reason);
  if (messageIncludes !== undefined) {
    expect(err.message).toContain(messageIncludes);
  }
}

describe('NetworkProtocol.validateEnvelope（Untrusted Input 防线）', () => {
  it('合法 envelope 通过：返回等价规范化副本（payload 浅引用保留、未知字段丢弃）', () => {
    const payload = { hp: 3, tags: ['a'] };
    const raw = { ...makeEnvelope({ payload }), extra: 'drop-me' };

    const validated = validateEnvelope(raw);

    expect(validated).toEqual(makeEnvelope({ payload }));
    expect(validated).not.toBe(raw);
    expect(validated.payload).toBe(payload);
    expect(validated.version).toBe(1);
  });

  it('边界值合法：turnId 0 / sequence 0 / payload null（决策：null = 显式无载荷）', () => {
    const validated = validateEnvelope(
      makeEnvelope({ turnId: 0, sequence: 0, senderId: 'P2', payload: null }),
    );
    expect(validated.turnId).toBe(0);
    expect(validated.sequence).toBe(0);
    expect(validated.senderId).toBe('P2');
    expect(validated.payload).toBeNull();
  });

  it('错误形态：NetworkProtocolError（instanceof Error、带 name 与 reason）', () => {
    let caught: unknown;
    try {
      validateEnvelope(null);
    } catch (error) {
      caught = error;
    }
    const err = caught as NetworkProtocolError;
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NetworkProtocolError');
    expect(err.reason).toBe('NOT_OBJECT');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it.each([
    null,
    [],
    ['not', 'an', 'envelope'],
    'PING',
    42,
    true,
    undefined,
  ])('非 plain object（case %#）→ NOT_OBJECT', (raw) => {
    expectReject(raw, 'NOT_OBJECT');
  });

  it.each(ENVELOPE_FIELD_NAMES)('缺少字段 %s → MISSING_FIELD（message 指明字段）', (field) => {
    const raw: Record<string, unknown> = { ...makeEnvelope() };
    delete raw[field];
    expectReject(raw, 'MISSING_FIELD', `"${field}"`);
  });

  it('未知 protocol version → UNSUPPORTED_VERSION（message 可识别具体版本）', () => {
    const v2: Record<string, unknown> = { ...makeEnvelope(), version: 2 };
    expectReject(v2, 'UNSUPPORTED_VERSION', '2');
    expectReject(v2, 'UNSUPPORTED_VERSION', 'version');

    const v0: Record<string, unknown> = { ...makeEnvelope(), version: 0 };
    expectReject(v0, 'UNSUPPORTED_VERSION');

    // 字符串 "1" 不等于数字 1 —— 严格拒绝
    const stringVersion: Record<string, unknown> = { ...makeEnvelope(), version: '1' };
    expectReject(stringVersion, 'UNSUPPORTED_VERSION', '"1"');
  });

  it('非法 message type → UNKNOWN_MESSAGE_TYPE', () => {
    const hack: Record<string, unknown> = { ...makeEnvelope(), type: 'HACK' };
    expectReject(hack, 'UNKNOWN_MESSAGE_TYPE', 'HACK');

    const numeric: Record<string, unknown> = { ...makeEnvelope(), type: 42 };
    expectReject(numeric, 'UNKNOWN_MESSAGE_TYPE');

    const nullType: Record<string, unknown> = { ...makeEnvelope(), type: null };
    expectReject(nullType, 'UNKNOWN_MESSAGE_TYPE');
  });

  it('matchId 非空 string → INVALID_MATCH_ID', () => {
    const empty: Record<string, unknown> = { ...makeEnvelope(), matchId: '' };
    expectReject(empty, 'INVALID_MATCH_ID');

    const numeric: Record<string, unknown> = { ...makeEnvelope(), matchId: 42 };
    expectReject(numeric, 'INVALID_MATCH_ID');

    const nullId: Record<string, unknown> = { ...makeEnvelope(), matchId: null };
    expectReject(nullId, 'INVALID_MATCH_ID');
  });

  it('turnId 必须整数 number → INVALID_TURN_ID', () => {
    expectReject({ ...makeEnvelope(), turnId: 1.5 }, 'INVALID_TURN_ID');
    expectReject({ ...makeEnvelope(), turnId: '7' }, 'INVALID_TURN_ID');
    expectReject({ ...makeEnvelope(), turnId: NaN }, 'INVALID_TURN_ID');
    expectReject({ ...makeEnvelope(), turnId: Infinity }, 'INVALID_TURN_ID');
  });

  it('senderId ∈ {P1, P2}（大小写敏感）→ INVALID_SENDER_ID', () => {
    const unknown: Record<string, unknown> = { ...makeEnvelope(), senderId: 'P9' };
    expectReject(unknown, 'INVALID_SENDER_ID', 'P9');

    const lower: Record<string, unknown> = { ...makeEnvelope(), senderId: 'p1' };
    expectReject(lower, 'INVALID_SENDER_ID');

    const nullSender: Record<string, unknown> = { ...makeEnvelope(), senderId: null };
    expectReject(nullSender, 'INVALID_SENDER_ID');
  });

  it('sequence 必须整数且 ≥ 0 → INVALID_SEQUENCE', () => {
    expectReject({ ...makeEnvelope(), sequence: -1 }, 'INVALID_SEQUENCE');
    expectReject({ ...makeEnvelope(), sequence: 1.5 }, 'INVALID_SEQUENCE');
    expectReject({ ...makeEnvelope(), sequence: 'x' }, 'INVALID_SEQUENCE');
    expectReject({ ...makeEnvelope(), sequence: NaN }, 'INVALID_SEQUENCE');
  });

  it('timestamp 必须整数 number → INVALID_TIMESTAMP', () => {
    expectReject({ ...makeEnvelope(), timestamp: 1.5 }, 'INVALID_TIMESTAMP');
    expectReject({ ...makeEnvelope(), timestamp: NaN }, 'INVALID_TIMESTAMP');
    expectReject({ ...makeEnvelope(), timestamp: 'now' }, 'INVALID_TIMESTAMP');
  });

  it('payload 决策：undefined 拒绝 / null 与任意 JSON 值合法', () => {
    // undefined 会被 JSON.stringify 静默丢键 → 在源头拒绝，而不是让对端报 MISSING_FIELD
    expectReject({ ...makeEnvelope(), payload: undefined }, 'INVALID_PAYLOAD');

    expect(validateEnvelope({ ...makeEnvelope(), payload: null }).payload).toBeNull();
    expect(validateEnvelope({ ...makeEnvelope(), payload: {} }).payload).toEqual({});
    expect(validateEnvelope({ ...makeEnvelope(), payload: 'text' }).payload).toBe('text');
    expect(validateEnvelope({ ...makeEnvelope(), payload: 0 }).payload).toBe(0);
  });
});
