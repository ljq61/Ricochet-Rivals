import {
  isSignalingIceServer,
  type SignalingIceServer,
} from '../../../src/game/network/signaling/SignalingMessage';

/**
 * Signaling Server 运行配置（SG-2）。
 *
 * 全部经环境变量注入、启动期 fail-fast（本文件是服务进程的可信本地输入，
 * 配错即抛 —— 与客户端 Untrusted Input 的 Result 双轨不同税制）。
 * secret 永不经由本配置出现（SG-6 coturn 凭据由 Signaling 动态生成，
 * shared secret 只存 TURN + Signaling 两侧环境变量，不入仓库）。
 */

export interface SignalingServerConfig {
  readonly port: number;
  /** 房间未配对保留期（规格 5~10min；超时删除并通知 Host） */
  readonly waitingTtlMs: number;
  /** 断开后持 peerToken 原位重连窗口（Host 超窗 → 房间删除） */
  readonly slotGraceMs: number;
  /** 过期清扫周期 */
  readonly sweepIntervalMs: number;
  /** ROOM_CREATED/ROOM_JOINED 携带的 ICE 配置（SG-6 接 coturn 动态凭据） */
  readonly iceServers: SignalingIceServer[];
}

const DEFAULT_WAITING_TTL_MS = 600_000;
const DEFAULT_SLOT_GRACE_MS = 30_000;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
const DEFAULT_PORT = 8787;
const DEFAULT_ICE_SERVERS: SignalingIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

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

function parseIceServers(env: ServerConfigEnv): SignalingIceServer[] {
  const raw = env['SIGNALING_ICE_SERVERS'];
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_ICE_SERVERS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `[serverConfig] SIGNALING_ICE_SERVERS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((entry) => isSignalingIceServer(entry))) {
    throw new Error(
      '[serverConfig] SIGNALING_ICE_SERVERS must be a non-empty JSON array of { urls, username?, credential? }',
    );
  }
  return parsed as SignalingIceServer[];
}

export function loadServerConfig(env: ServerConfigEnv = process.env): SignalingServerConfig {
  return {
    port: parsePositiveInt(env, 'PORT', DEFAULT_PORT),
    waitingTtlMs: parsePositiveInt(env, 'SIGNALING_WAITING_TTL_MS', DEFAULT_WAITING_TTL_MS),
    slotGraceMs: parsePositiveInt(env, 'SIGNALING_SLOT_GRACE_MS', DEFAULT_SLOT_GRACE_MS),
    sweepIntervalMs: parsePositiveInt(env, 'SIGNALING_SWEEP_INTERVAL_MS', DEFAULT_SWEEP_INTERVAL_MS),
    iceServers: parseIceServers(env),
  };
}
