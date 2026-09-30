import { createHmac } from 'node:crypto';

/**
 * TURN REST API 凭据（SG-6，coturn `use-auth-secret` + `static-auth-secret`）。
 *
 * 规格（Online Connection Migration — TURN Security）：
 * * 禁止长期 TURN Password 出现在 GitHub / GitHub Pages / VITE env / Client
 *   bundle —— 浏览器只拿 temporary username + temporary credential + 隐式 TTL。
 * * Shared Secret 只存在 TURN server（coturn static-auth-secret）与 Signaling
 *   server（SIGNALING_TURN_SHARED_AUTH_SECRET）两侧环境变量，永不入库。
 *
 * coturn REST API 契约：
 * * username = 凭据过期的 unix 秒（`<expiry>`）
 * * credential = base64(HMAC-SHA1(sharedSecret, username))
 * * coturn 校验：解析 username 的 expiry 未过期 + HMAC 匹配即放行
 */

export interface TurnRestCredential {
  /** 过期 unix 秒（字符串 —— 即 coturn REST username 本身） */
  readonly username: string;
  /** base64(HMAC-SHA1(sharedSecret, username)) */
  readonly credential: string;
  /** 过期时刻（unix 秒，数字形态 —— 诊断/测试用） */
  readonly expiresAtUnix: number;
}

export function generateTurnCredential(
  sharedSecret: string,
  ttlMs: number,
  now: number = Date.now(),
): TurnRestCredential {
  const expiresAtUnix = Math.floor((now + ttlMs) / 1000);
  const username = String(expiresAtUnix);
  const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
  return { username, credential, expiresAtUnix };
}
