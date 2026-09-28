/**
 * ConnectionCodeCodec（Phase 13）—— 手动配对连接码编解码。
 *
 * 连接码 = 人类可识别前缀 + base64url(JSON(payload))，单段可复制文本，
 * 便于微信 / 聊天软件传输：
 *
 *   RR1-OFFER-<base64url>   Host 生成的 Offer Code
 *   RR1-ANSWER-<base64url>  Guest 回传的 Response Code
 *
 * Payload（Option B）：sdp 存**原始 SDP 文本**，kind 即 type 来源 ——
 * Controller 桥接：transport 信令（JSON {type,sdp}）→ 提取 sdp → 本 codec；
 * 解码后由 `JSON.stringify({type: kind, sdp})` 还原传给 acceptOffer/acceptAnswer。
 *
 * decodeConnectionCode 永不 throw：用户输入是预期垃圾，全部走
 * {ok:false, reason} Result 双轨（与 NetworkSerializer 同风格）。
 * 纯函数、零 transport 依赖；base64url 为纯 TS 实现（禁 btoa/atob/Buffer，
 * 浏览器 + node 双环境）。
 */

export interface ConnectionCodePayload {
  readonly version: 1;
  readonly kind: 'offer' | 'answer';
  /** 原始 SDP 文本（非 {type,sdp} JSON） */
  readonly sdp: string;
}

export type ConnectionCodeRejectReason =
  | 'EMPTY'
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'WRONG_CODE_TYPE'
  | 'INVALID_SDP'
  | 'MALFORMED_PAYLOAD';

export type DecodeConnectionCodeResult =
  | { ok: true; payload: ConnectionCodePayload }
  | { ok: false; reason: ConnectionCodeRejectReason };

const OFFER_PREFIX = 'RR1-OFFER-';
const ANSWER_PREFIX = 'RR1-ANSWER-';
/** 前缀版本解析：RR<N>-OFFER- / RR<N>-ANSWER-（version≠1 快速拒绝） */
const PREFIX_PATTERN = /^RR(\d+)-(OFFER|ANSWER)-/;

export function encodeConnectionCode(payload: ConnectionCodePayload): string {
  const prefix = payload.kind === 'offer' ? OFFER_PREFIX : ANSWER_PREFIX;
  return prefix + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeConnectionCode(
  raw: string,
  expectedKind?: 'offer' | 'answer'
): DecodeConnectionCodeResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'EMPTY' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'EMPTY' };
  }

  const match = PREFIX_PATTERN.exec(trimmed);
  if (match === null) {
    return { ok: false, reason: 'INVALID_FORMAT' };
  }
  const [, versionText, kindText] = match;
  if (versionText !== '1') {
    return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  }
  const kind = kindText === 'OFFER' ? 'offer' : 'answer';
  if (expectedKind !== undefined && kind !== expectedKind) {
    return { ok: false, reason: 'WRONG_CODE_TYPE' };
  }

  const body = trimmed.slice(match[0].length);
  const bytes = base64UrlToBytes(body);
  if (bytes === null) {
    return { ok: false, reason: 'INVALID_FORMAT' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: 'MALFORMED_PAYLOAD' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'MALFORMED_PAYLOAD' }
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1 || candidate.kind !== kind || typeof candidate.sdp !== 'string') {
    // version/kind 与前缀不符 = payload 被篡改或编码错乱；sdp 类型错误同拒
    return candidate.version !== 1
      ? { ok: false, reason: 'UNSUPPORTED_VERSION' }
      : { ok: false, reason: 'MALFORMED_PAYLOAD' };
  }
  if (candidate.sdp.length === 0) {
    return { ok: false, reason: 'INVALID_SDP' };
  }
  return { ok: true, payload: { version: 1, kind, sdp: candidate.sdp } };
}

// ---- base64url 纯 TS（浏览器 + node 双环境） -----------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] ?? 0 : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] ?? 0 : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[triple & 63] : '=';
  }
  return out;
}

function base64UrlToBytes(text: string): Uint8Array | null {
  // 末尾 '=' 填充剥离；长度 %4==1 非法
  let body = text.replace(/=+$/, '');
  if (body.length === 0) {
    return null;
  }
  if (body.length % 4 === 1) {
    return null;
  }
  const charMap = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    charMap.set(ALPHABET[i] ?? '', i);
  }

  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of body) {
    const value = charMap.get(char);
    if (value === undefined) {
      return null; // 非法字符（含标准 base64 的 +/ 与空白）
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
