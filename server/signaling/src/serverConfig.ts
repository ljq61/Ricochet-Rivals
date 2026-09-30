import type { SignalingIceServer } from '../../../src/game/network/signaling/SignalingMessage';
import { generateTurnCredential } from './turnCredentials';

/**
 * Signaling Server 运行配置（SG-2 / SG-6）。
 *
 * 全部经环境变量注入、启动期 fail-fast（服务进程的可信本地输入，配错即抛
 * —— 与客户端 Untrusted Input 的 Result 双轨不同税制）。
 *
 * TURN（SG-6 规格）：
 * * Shared Secret 只经 SIGNALING_TURN_SHARED_AUTH_SECRET 环境变量注入 ——
 *   与 coturn `static-auth-secret` 相同；**永不入仓库 / 客户端 bundle**。
 * * TURN urls（udp/tcp/tls）经 SIGNALING_TURN_URLS 注入；每 ROOM ack 现生成
 *   time-limited 凭据（默认 30min，规格 30~60min）。
 * * TURN urls 与 secret 必须成对配置，缺一即启动失败。
 */

export interface SignalingServerConfig {
  readonly port: number;
  /** 房间未配对保留期（规格 5~10min；超时删除并通知 Host） */
  readonly waitingTtlMs: number;
  /** 断开后持 peerToken 原位重连窗口（Host 超窗 → 房间删除） */
  readonly slotGraceMs: number;
  /** 过期清扫周期 */
  readonly sweepIntervalMs: number;
  /** ROOM ack 携带的 STUN 列表 */
  readonly stunUrls: string[];
  /** ROOM ack 携带的 TURN 列表（空 = 未部署 TURN，本地开发常态） */
  readonly turnUrls: string[];
  /** coturn shared secret（与 static-auth-secret 相同；无 TURN 时空） */
  readonly turnSharedSecret: string | null;
  /** TURN 凭据 TTL（默认 30min，规格 30~60min） */
  readonly turnCredentialTtlMs: number;
}

const DEFAULT_WAITING_TTL_MS = 600_000;
const DEFAULT_SLOT_GRACE_MS = 30_000;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
const DEFAULT_PORT = 8787;
const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302'];
const DEFAULT_TURN_CREDENTIAL_TTL_MS = 30 * 60_000;

export type ServerConfigEnv = Record<string, string | undefined>;

function parsePositiveInt(env: ServerConfigEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[serverConfig] ${name} must be a non-negative integer (got '${raw}')`);
  }
  return value;
}

function parseUrlList(env: ServerConfigEnv, name: string): string[] | null {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const url of list) {
    const scheme = url.split(':')[0] ?? '';
    if (!url.startsWith('stun:') && !url.startsWith('turn:') && !url.startsWith('turns:')) {
      throw new Error(`[serverConfig] ${name} entries must start with stun:/turn:/turns: (got '${url}')`);
    }
    void scheme;
  }
  return list;
}

export function loadServerConfig(env: ServerConfigEnv = process.env): SignalingServerConfig {
  const stunUrls = parseUrlList(env, 'SIGNALING_STUN_URLS') ?? DEFAULT_STUN_URLS;
  const turnUrls = parseUrlList(env, 'SIGNALING_TURN_URLS') ?? [];
  const secret = env['SIGNALING_TURN_SHARED_AUTH_SECRET']?.trim() || null;
  if (turnUrls.length > 0 && secret === null) {
    throw new Error(
      '[serverConfig] SIGNALING_TURN_URLS set without SIGNALING_TURN_SHARED_AUTH_SECRET — TURN credentials cannot be generated (secret must match coturn static-auth-secret)',
    );
  }
  if (turnUrls.length === 0 && secret !== null) {
    throw new Error(
      '[serverConfig] SIGNALING_TURN_SHARED_AUTH_SECRET set without SIGNALING_TURN_URLS — configure the TURN server urls',
    );
  }
  return {
    port: parsePositiveInt(env, 'PORT', DEFAULT_PORT),
    waitingTtlMs: parsePositiveInt(env, 'SIGNALING_WAITING_TTL_MS', DEFAULT_WAITING_TTL_MS),
    slotGraceMs: parsePositiveInt(env, 'SIGNALING_SLOT_GRACE_MS', DEFAULT_SLOT_GRACE_MS),
    sweepIntervalMs: parsePositiveInt(env, 'SIGNALING_SWEEP_INTERVAL_MS', DEFAULT_SWEEP_INTERVAL_MS),
    stunUrls,
    turnUrls,
    turnSharedSecret: secret,
    turnCredentialTtlMs: parsePositiveInt(
      env,
      'SIGNALING_TURN_CREDENTIAL_TTL_MS',
      DEFAULT_TURN_CREDENTIAL_TTL_MS,
    ),
  };
}

/**
 * ROOM ack 的 iceServers 供给器（SG-6 规格：Signaling 在 ROOM_CREATED /
 * ROOM_JOINED 时返回 iceServers = [STUN, TURN temporary credential]）。
 * TURN 凭据每次调用现生成 —— 各 peer 拿到独立的时间受限凭据。
 */
export function createIceServersProvider(
  config: Pick<SignalingServerConfig, 'stunUrls' | 'turnUrls' | 'turnSharedSecret' | 'turnCredentialTtlMs'>,
): () => SignalingIceServer[] {
  return () => {
    const iceServers: SignalingIceServer[] = config.stunUrls.map((urls) => ({ urls }));
    if (config.turnUrls.length > 0 && config.turnSharedSecret !== null) {
      const { username, credential } = generateTurnCredential(
        config.turnSharedSecret,
        config.turnCredentialTtlMs,
      );
      iceServers.push({ urls: config.turnUrls, username, credential });
    }
    return iceServers;
  };
}
