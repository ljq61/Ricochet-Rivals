import type { NetworkEnvelope } from '../NetworkEnvelope';
import { NetworkProtocolError, validateEnvelope } from '../NetworkProtocol';

/**
 * envelope 的 JSON 序列化收敛点 —— 全项目只允许在这里
 * JSON.stringify / JSON.parse envelope（CODELY.md §6：只同步命令与事件，不逐帧同步）。
 *
 * 错误处理双轨、同一税制（Phase 12 设计决策）：
 * * serializeEnvelope —— 发送前先 validateEnvelope（结构校验 + 规范化：
 *   固定字段序、丢弃未知字段），非法 envelope 直接 throw NetworkProtocolError
 *   （坏数据不上线，也不静默丢字段）。payload 深层循环引用会让 JSON.stringify
 *   抛 TypeError —— 原样上抛，不吞。
 * * deserializeEnvelope —— 返回 Result 联合：网络收到垃圾是预期路径，
 *   调用方按 ok 判别分流（TS 强制检查），错误类型仍是 NetworkProtocolError。
 */
export interface DeserializeSuccess {
  ok: true;
  envelope: NetworkEnvelope;
}

export interface DeserializeFailure {
  ok: false;
  error: NetworkProtocolError;
}

export type DeserializeResult = DeserializeSuccess | DeserializeFailure;

/** 序列化：校验 + 规范化 + JSON.stringify。版本演进只改这里与 validateEnvelope。 */
export function serializeEnvelope(envelope: NetworkEnvelope): string {
  const canonical = validateEnvelope(envelope);
  return JSON.stringify(canonical);
}

/** 反序列化：JSON.parse + validateEnvelope；失败以 Result 返回（不 throw、不静默）。 */
export function deserializeEnvelope(raw: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: new NetworkProtocolError(
        'INVALID_JSON',
        `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  try {
    return { ok: true, envelope: validateEnvelope(parsed) };
  } catch (error) {
    if (error instanceof NetworkProtocolError) {
      return { ok: false, error };
    }
    throw error; // 未知异常：不吞、不包装
  }
}
