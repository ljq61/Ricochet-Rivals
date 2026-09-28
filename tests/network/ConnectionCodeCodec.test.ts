import { describe, expect, it } from 'vitest';
import {
  ConnectionCodePayload,
  decodeConnectionCode,
  encodeConnectionCode,
} from '../../src/game/network/signaling/ConnectionCodeCodec';

/**
 * ConnectionCodeCodec（Phase 13 验收 1–6）：
 * 连接码 = RR1-OFFER-/RR1-ANSWER- 前缀 + base64url(JSON)。
 * 编码 oracle 用独立实现的 btoa/atob 路线（TextEncoder 处理 unicode），
 * 与被测的纯 TS 实现互为交叉验证。
 */

/** 独立 oracle：utf8 文本 → base64url（不经被测代码） */
function oracleEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** 独立 oracle：base64url → utf8 文本 */
function oracleDecode(body: string): string {
  const std = body.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (body.length % 4)) % 4);
  const binary = atob(std);
  const bytes = new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
  return new TextDecoder().decode(bytes);
}

const offerText = (payload: unknown): string => `RR1-OFFER-${oracleEncode(JSON.stringify(payload))}`;
const answerText = (payload: unknown): string => `RR1-ANSWER-${oracleEncode(JSON.stringify(payload))}`;

const OFFER_PAYLOAD: ConnectionCodePayload = {
  version: 1,
  kind: 'offer',
  sdp: 'v=0\r\no=- 461173 2 IN IP4 127.0.0.1\r\n',
};
const ANSWER_PAYLOAD: ConnectionCodePayload = {
  version: 1,
  kind: 'answer',
  sdp: 'v=0\r\no=- 461175 2 IN IP4 127.0.0.1\r\n',
};

describe('ConnectionCodeCodec', () => {
  it('1. Offer code encode/decode 往返保真', () => {
    const code = encodeConnectionCode(OFFER_PAYLOAD);
    expect(code.startsWith('RR1-OFFER-')).toBe(true);
    const decoded = decodeConnectionCode(code, 'offer');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload).toEqual(OFFER_PAYLOAD);
  });

  it('2. Answer code encode/decode 往返保真', () => {
    const code = encodeConnectionCode(ANSWER_PAYLOAD);
    expect(code.startsWith('RR1-ANSWER-')).toBe(true);
    const decoded = decodeConnectionCode(code, 'answer');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload).toEqual(ANSWER_PAYLOAD);
  });

  it('3. WRONG_CODE_TYPE：offer code 用于 answer 场景（及反向）', () => {
    const offerCode = encodeConnectionCode(OFFER_PAYLOAD);
    const wrong = decodeConnectionCode(offerCode, 'answer');
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.reason).toBe('WRONG_CODE_TYPE');

    const answerCode = encodeConnectionCode(ANSWER_PAYLOAD);
    const wrongBack = decodeConnectionCode(answerCode, 'offer');
    expect(wrongBack.ok).toBe(false);
    if (wrongBack.ok) return;
    expect(wrongBack.reason).toBe('WRONG_CODE_TYPE');
  });

  it('4. UNSUPPORTED_VERSION：RR2 前缀与 payload version≠1 均拒绝（双路径）', () => {
    // 路径 A：前缀版本 RR2 → 快速拒绝（字面量构造，不经 oracle 的 RR1 模板）
    const byPrefix = decodeConnectionCode('RR2-OFFER-YWJj', 'offer');
    expect(byPrefix.ok).toBe(false);
    if (byPrefix.ok) return;
    expect(byPrefix.reason).toBe('UNSUPPORTED_VERSION');

    // 路径 B：前缀 RR1 但 payload.version=2 → 同样拒绝
    const byPayload = decodeConnectionCode(offerText({ version: 2, kind: 'offer', sdp: 'x' }), 'offer');
    expect(byPayload.ok).toBe(false);
    if (byPayload.ok) return;
    expect(byPayload.reason).toBe('UNSUPPORTED_VERSION');
  });

  it('5. INVALID_FORMAT：非法 base64url 字符 / 无前缀 / 长度非法', () => {
    const noPrefix = decodeConnectionCode('hello-world', undefined);
    expect(noPrefix.ok).toBe(false);
    if (noPrefix.ok) return;
    expect(noPrefix.reason).toBe('INVALID_FORMAT');

    const badChars = decodeConnectionCode('RR1-OFFER-###', undefined);
    expect(badChars.ok).toBe(false);
    if (badChars.ok) return;
    expect(badChars.reason).toBe('INVALID_FORMAT');

    // 标准 base64 的 + / 在 url-safe alphabet 中非法
    const plusSlash = decodeConnectionCode('RR1-OFFER-a+b/c=', undefined);
    expect(plusSlash.ok).toBe(false);
    if (plusSlash.ok) return;
    expect(plusSlash.reason).toBe('INVALID_FORMAT');

    // 长度 %4==1 非法
    const oddLength = decodeConnectionCode('RR1-OFFER-abcde', undefined);
    expect(oddLength.ok).toBe(false);
    if (oddLength.ok) return;
    expect(oddLength.reason).toBe('INVALID_FORMAT');
  });

  it('6. MALFORMED_PAYLOAD：坏 JSON / 非对象 / kind 与前缀不符', () => {
    const badJson = decodeConnectionCode(offerTextRaw('not-json{'), 'offer');
    expect(badJson.ok).toBe(false);
    if (badJson.ok) return;
    expect(badJson.reason).toBe('MALFORMED_PAYLOAD');

    const nonObject = decodeConnectionCode(offerTextRaw('"string"'), 'offer');
    expect(nonObject.ok).toBe(false);
    if (nonObject.ok) return;
    expect(nonObject.reason).toBe('MALFORMED_PAYLOAD');

    // 前缀 OFFER 但 payload.kind = answer → 篡改/错乱
    const mismatched = decodeConnectionCode(offerText({ version: 1, kind: 'answer', sdp: 'x' }), 'offer');
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.reason).toBe('MALFORMED_PAYLOAD');

    // sdp 类型错误（非字符串）→ MALFORMED_PAYLOAD
    const badSdpType = decodeConnectionCode(offerText({ version: 1, kind: 'offer', sdp: 42 }), 'offer');
    expect(badSdpType.ok).toBe(false);
    if (badSdpType.ok) return;
    expect(badSdpType.reason).toBe('MALFORMED_PAYLOAD');
  });

  it('7. INVALID_SDP：空 SDP 拒绝', () => {
    const emptySdp = decodeConnectionCode(offerText({ version: 1, kind: 'offer', sdp: '' }), 'offer');
    expect(emptySdp.ok).toBe(false);
    if (emptySdp.ok) return;
    expect(emptySdp.reason).toBe('INVALID_SDP');
  });

  it('8. EMPTY：空串 / 纯空白拒绝', () => {
    for (const raw of ['', '   ', '\n\t']) {
      const result = decodeConnectionCode(raw, 'offer');
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('EMPTY');
    }
  });

  it('9. trim 容错 + oracle 双向一致（unicode 往返）', () => {
    const code = encodeConnectionCode(OFFER_PAYLOAD);
    const padded = `  ${code}  \n`;
    const decoded = decodeConnectionCode(padded, 'offer');
    expect(decoded.ok).toBe(true);

    // oracle 编码 → 本 codec 解码（双向互认）
    const cross = decodeConnectionCode(answerText(ANSWER_PAYLOAD), 'answer');
    expect(cross.ok).toBe(true);
    if (!cross.ok) return;
    expect(cross.payload).toEqual(ANSWER_PAYLOAD);

    // 本 codec 编码 body → oracle 解码（unicode 往返）
    const unicodePayload: ConnectionCodePayload = {
      version: 1,
      kind: 'offer',
      sdp: '中文-SDP-🐉',
    };
    const mine = encodeConnectionCode(unicodePayload);
    const body = mine.slice('RR1-OFFER-'.length);
    expect(JSON.parse(oracleDecode(body))).toEqual(unicodePayload);
  });
});

/** 原始文本（非 JSON 对象）→ RR1-OFFER- 前缀码（坏 JSON 用例） */
function offerTextRaw(raw: string): string {
  return `RR1-OFFER-${oracleEncode(raw)}`;
}
