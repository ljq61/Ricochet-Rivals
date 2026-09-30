import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateTurnCredential } from '../src/turnCredentials';

/**
 * TURN REST 凭据（SG-6，coturn use-auth-secret 契约）：
 * username = 过期 unix 秒；credential = base64(HMAC-SHA1(secret, username))。
 * Secret 只经环境变量注入（与 coturn static-auth-secret 相同），永不入库。
 */

const SECRET = 'unit-test-shared-secret';
const NOW = 1_700_000_000_000;
const TTL_MS = 30 * 60_000;

describe('turnCredentials', () => {
  it('1. username = 过期 unix 秒（now + TTL）；credential = base64(HMAC-SHA1) 独立 oracle 验证', () => {
    const credential = generateTurnCredential(SECRET, TTL_MS, NOW);
    const expectedExpiry = Math.floor((NOW + TTL_MS) / 1000);
    expect(credential.username).toBe(String(expectedExpiry));
    expect(credential.expiresAtUnix).toBe(expectedExpiry);

    // 独立 oracle：不经被测函数的 HMAC 复算
    const oracle = createHmac('sha1', SECRET).update(String(expectedExpiry)).digest('base64');
    expect(credential.credential).toBe(oracle);
    // base64(SHA1) 恒为 28 字符（20 字节 + padding）
    expect(credential.credential).toHaveLength(28);
  });

  it('2. TTL 数学：ttl 变化 → expiry 平移；secret 变化 → credential 变化', () => {
    const short = generateTurnCredential(SECRET, 60_000, NOW);
    const long = generateTurnCredential(SECRET, 60 * 60_000, NOW);
    expect(short.expiresAtUnix).toBe(Math.floor((NOW + 60_000) / 1000));
    expect(long.expiresAtUnix - short.expiresAtUnix).toBe(59 * 60);

    const other = generateTurnCredential('different-secret', TTL_MS, NOW);
    expect(other.credential).not.toBe(generateTurnCredential(SECRET, TTL_MS, NOW).credential);
  });
});
