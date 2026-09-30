import { describe, expect, it } from 'vitest';
import {
  createIceServersProvider,
  loadServerConfig,
  type ServerConfigEnv,
} from '../src/serverConfig';

/**
 * Server 配置 + iceServers 供给器（SG-6）：
 * TURN urls 与 shared secret 必须成对（fail-fast）；缺 TURN = 本地开发常态
 * （仅 STUN，直连）；有 TURN 时每 ack 现生成 time-limited 凭据。
 */

const BASE_ENV: ServerConfigEnv = {};

describe('serverConfig (SG-6)', () => {
  it('1. 默认：Google STUN、无 TURN、无 secret、凭据 TTL 30min', () => {
    const config = loadServerConfig({ ...BASE_ENV });
    expect(config.stunUrls).toEqual(['stun:stun.l.google.com:19302']);
    expect(config.turnUrls).toEqual([]);
    expect(config.turnSharedSecret).toBeNull();
    expect(config.turnCredentialTtlMs).toBe(30 * 60_000);
    expect(config.port).toBe(8787);
    expect(config.heartbeatIntervalMs).toBe(5_000);
    expect(config.heartbeatTimeoutMs).toBe(10_000);
  });

  it('2. 互斥 fail-fast：TURN urls 无 secret → throw；secret 无 urls → throw', () => {
    expect(() =>
      loadServerConfig({ SIGNALING_TURN_URLS: 'turn:turn.example.com:3478?transport=udp' }),
    ).toThrow(/without SIGNALING_TURN_SHARED_AUTH_SECRET/);

    expect(() =>
      loadServerConfig({ SIGNALING_TURN_SHARED_AUTH_SECRET: 's3cret' }),
    ).toThrow(/without SIGNALING_TURN_URLS/);
  });

  it('3. 逗号列表解析：stun:/turn:/turns: 合法；其他 scheme 拒绝', () => {
    const config = loadServerConfig({
      SIGNALING_STUN_URLS: 'stun:stun.a:3478, stun:stun.b:3478',
      SIGNALING_TURN_URLS:
        'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp',
      SIGNALING_TURN_SHARED_AUTH_SECRET: 's3cret',
    });
    expect(config.stunUrls).toEqual(['stun:stun.a:3478', 'stun:stun.b:3478']);
    expect(config.turnUrls).toHaveLength(3);

    expect(() => loadServerConfig({ SIGNALING_TURN_URLS: 'http://bad:1234' })).toThrow(/stun:\/turn:\/turns:/);
  });

  it('4. provider：无 TURN → 仅 STUN；有 TURN → STUN + TURN 临时凭据（可重复现生成）', () => {
    const stunOnly = createIceServersProvider({
      stunUrls: ['stun:stun.x:3478'],
      turnUrls: [],
      turnSharedSecret: null,
      turnCredentialTtlMs: 30 * 60_000,
    });
    expect(stunOnly()).toEqual([{ urls: 'stun:stun.x:3478' }]);

    const withTurn = createIceServersProvider({
      stunUrls: ['stun:stun.x:3478'],
      turnUrls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'],
      turnSharedSecret: 's3cret',
      turnCredentialTtlMs: 45 * 60_000,
    });
    const iceServers = withTurn();
    expect(iceServers).toHaveLength(2);
    expect(iceServers[0]).toEqual({ urls: 'stun:stun.x:3478' });
    const turnEntry = iceServers[1];
    expect(turnEntry?.urls).toEqual([
      'turn:turn.example.com:3478?transport=udp',
      'turn:turn.example.com:3478?transport=tcp',
    ]);
    // coturn REST 凭据形态：username = unix 秒数字串；credential = base64
    expect(turnEntry?.username).toMatch(/^\d{10,}$/);
    expect(turnEntry?.credential).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    // 再次调用 → 新凭据（每 ack 现生成）
    expect(withTurn()[1]?.username).toMatch(/^\d{10,}$/);
  });

  it('heartbeat 配置：正数毫秒可覆盖；零/负数/超出 Node timer 范围启动即拒绝', () => {
    const config = loadServerConfig({
      SIGNALING_HEARTBEAT_INTERVAL_MS: '1000',
      SIGNALING_HEARTBEAT_TIMEOUT_MS: '2500',
    });
    expect(config.heartbeatIntervalMs).toBe(1000);
    expect(config.heartbeatTimeoutMs).toBe(2500);
    for (const name of ['SIGNALING_HEARTBEAT_INTERVAL_MS', 'SIGNALING_HEARTBEAT_TIMEOUT_MS']) {
      for (const value of ['0', '-1', '1.5', '2147483648']) {
        expect(() => loadServerConfig({ [name]: value })).toThrow();
      }
    }
  });
});
