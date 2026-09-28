import type { NetworkEnvelope } from '../../src/game/network/NetworkEnvelope';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';

/**
 * 测试用 envelope 工厂：只生产合法基线，逐字段覆盖。
 * matchId / turnId / senderId 均为占位值（真实赋值归 NetworkManager，Phase 12 委托②）。
 * 需要非法 envelope 时直接构造 raw 对象 —— 类型系统会阻止经本工厂产出坏数据。
 */
export function makeEnvelope(overrides: Partial<NetworkEnvelope> = {}): NetworkEnvelope {
  return {
    version: 1,
    type: NetworkMessageType.PING,
    matchId: 'match-e2e-1',
    turnId: 7,
    senderId: 'P1',
    sequence: 0,
    timestamp: 1_769_000_000_000,
    payload: null,
    ...overrides,
  };
}
