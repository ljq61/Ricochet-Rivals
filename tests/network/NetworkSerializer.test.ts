import { describe, expect, it } from 'vitest';
import type { NetworkEnvelope } from '../../src/game/network/NetworkEnvelope';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { NetworkProtocolError } from '../../src/game/network/NetworkProtocol';
import {
  deserializeEnvelope,
  serializeEnvelope,
} from '../../src/game/network/serialization/NetworkSerializer';
import { makeEnvelope } from './envelopeFixture';

describe('NetworkSerializer（JSON 收敛点）', () => {
  it('serialize → deserialize 往返保真（对象 payload 深等价）', () => {
    const original = makeEnvelope({
      type: NetworkMessageType.FIRE,
      payload: { startX: 450, startY: 300, velocityX: 800, velocityY: -600, seed: 42 },
    });

    const result = deserializeEnvelope(serializeEnvelope(original));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.envelope).toEqual(original);
  });

  it('往返保真：payload null / 空串 / 0 等边界 JSON 值不丢失', () => {
    const roundTripPayload = (envelope: NetworkEnvelope): unknown => {
      const result = deserializeEnvelope(serializeEnvelope(envelope));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      return result.envelope.payload;
    };

    expect(roundTripPayload(makeEnvelope({ payload: null }))).toBeNull();
    expect(roundTripPayload(makeEnvelope({ payload: '' }))).toBe('');
    expect(roundTripPayload(makeEnvelope({ payload: 0 }))).toBe(0);
  });

  it('序列化为确定性 JSON（固定字段序 canonical —— Phase 15 stateHash 的基础）', () => {
    expect(serializeEnvelope(makeEnvelope())).toBe(
      '{"version":1,"type":"PING","matchId":"match-e2e-1","turnId":7,"senderId":"P1","sequence":0,"timestamp":1769000000000,"payload":null}',
    );
  });

  it('serialize 丢弃未知字段（canonical 化）', () => {
    const withExtra = { ...makeEnvelope(), extra: 'drop-me' };
    expect(serializeEnvelope(withExtra)).toBe(serializeEnvelope(makeEnvelope()));
  });

  it('serialize 非法 envelope：同步抛 NetworkProtocolError（坏数据不上线）', () => {
    // 故意非法的 envelope：测试专用双重断言越过类型防线（生产代码禁止此写法）
    const badVersion = { ...makeEnvelope(), version: 2 } as unknown as NetworkEnvelope;
    expect(() => serializeEnvelope(badVersion)).toThrow(NetworkProtocolError);

    const badPayload = { ...makeEnvelope(), payload: undefined };
    expect(() => serializeEnvelope(badPayload)).toThrow(NetworkProtocolError);
  });

  it('非法 JSON → INVALID_JSON（Result 失败、不 throw、不静默）', () => {
    const result = deserializeEnvelope('{"version":1, oops}');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBeInstanceOf(NetworkProtocolError);
    expect(result.error.reason).toBe('INVALID_JSON');
    expect(result.error.message).toContain('invalid JSON');
  });

  it.each(['not json at all', 'undefined', ''])('完全非法的字符串（%p）→ INVALID_JSON', (raw) => {
    const result = deserializeEnvelope(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.reason).toBe('INVALID_JSON');
  });

  it.each(['null', '[]', '"hello"', '42', 'true'])(
    '合法 JSON 但非 envelope：%p → NOT_OBJECT',
    (raw) => {
      const result = deserializeEnvelope(raw);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toBe('NOT_OBJECT');
    },
  );

  it('合法 JSON 但 envelope 非法：透传字段级拒绝原因', () => {
    const unknownVersion = serializeEnvelope(makeEnvelope()).replace('"version":1', '"version":2');
    const versionResult = deserializeEnvelope(unknownVersion);
    expect(versionResult.ok).toBe(false);
    if (versionResult.ok) return;
    expect(versionResult.error.reason).toBe('UNSUPPORTED_VERSION');

    const missingResult = deserializeEnvelope('{}');
    expect(missingResult.ok).toBe(false);
    if (missingResult.ok) return;
    expect(missingResult.error.reason).toBe('MISSING_FIELD');
    expect(missingResult.error.message).toContain('"version"');
  });
});
