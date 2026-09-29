import { TurnPhase } from '../../../state/TurnPhase';
import { PLAYER_IDS, type PlayerId } from '../../../state/ids';
import { computeStateHash } from '../AuthoritativeState';
import { isStateSnapshotPayload } from '../OnlinePayloads';
import type { AuthoritativeGameSnapshot } from '../OnlineTypes';

/**
 * STATE_SNAPSHOT 语义校验器（Phase 15）。
 *
 * 形状防线（isStateSnapshotPayload）之外的第二道校验：即使 Host 是
 * 权威，网络数据也必须过语义检查（CODELY.md 信任边界 —— wire 是
 * Untrusted Input）。Guest 只在 { ok: true } 时才允许
 * applyAuthoritativeSnapshot。
 *
 * 纯函数、零网络 / Phaser 依赖；ok=false 一律带可读 reason（诊断 /
 * DEBUG_NETWORK 显示 / 测试断言）。
 */

export interface SnapshotValidationContext {
  /** 本端 matchId（GAME_START 锁定）—— 不符即拒 */
  readonly expectedMatchId: string;
}

export type SnapshotValidationResult =
  | { ok: true; snapshot: AuthoritativeGameSnapshot }
  | { ok: false; reason: string };

/** TurnPhase 合法值白名单（运行时枚举值集合） */
const TURN_PHASE_VALUES: ReadonlySet<string> = new Set(Object.values(TurnPhase));

export function validateAuthoritativeSnapshot(
  payload: unknown,
  context: SnapshotValidationContext,
): SnapshotValidationResult {
  if (!isStateSnapshotPayload(payload)) {
    return { ok: false, reason: 'SNAPSHOT_MALFORMED' };
  }
  const snapshot = payload.snapshot;
  if (snapshot.matchId !== context.expectedMatchId) {
    return { ok: false, reason: `MATCH_ID_MISMATCH(${snapshot.matchId})` };
  }
  if (!Number.isInteger(snapshot.turnId) || snapshot.turnId < 1) {
    return { ok: false, reason: `BAD_TURN_ID(${snapshot.turnId})` };
  }
  if (!TURN_PHASE_VALUES.has(snapshot.phase)) {
    return { ok: false, reason: `BAD_PHASE(${String(snapshot.phase)})` };
  }
  for (const playerId of PLAYER_IDS) {
    const p = snapshot.players[playerId];
    if (p === undefined) {
      return { ok: false, reason: `PLAYER_MISSING(${playerId})` };
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return { ok: false, reason: `POSITION_NOT_FINITE(${playerId})` };
    }
    if (!Number.isFinite(p.hp) || p.hp < 0 || p.hp > p.maxHp) {
      return { ok: false, reason: `HP_OUT_OF_RANGE(${playerId}:${p.hp}/${p.maxHp})` };
    }
    if (!Number.isFinite(p.moveRemaining) || p.moveRemaining < 0) {
      return { ok: false, reason: `MOVE_REMAINING_INVALID(${playerId})` };
    }
  }
  // gameOver ↔ winnerId 联动：gameOver=false 时必须无胜者；
  // gameOver=true 时 winnerId 可为 null（同归于尽平局）
  if (!snapshot.gameOver && snapshot.winnerId !== null) {
    return { ok: false, reason: 'WINNER_WITHOUT_GAME_OVER' };
  }
  if (snapshot.gameOver && !PLAYER_IDS.includes(snapshot.winnerId as PlayerId) && snapshot.winnerId !== null) {
    return { ok: false, reason: `BAD_WINNER(${String(snapshot.winnerId)})` };
  }
  // 快照自洽：payload.stateHash 必须等于对 snapshot 重算的 hash
  // （坏数据 / 版本漂移 / 篡改在此拦截）
  const recomputed = computeStateHash({
    matchId: snapshot.matchId,
    seed: snapshot.seed,
    turnId: snapshot.turnId,
    currentPlayerId: snapshot.currentPlayerId,
    phase: snapshot.phase,
    players: snapshot.players,
    items: [...snapshot.items],
    gameOver: snapshot.gameOver,
    winnerId: snapshot.winnerId,
  });
  if (recomputed !== payload.stateHash) {
    return { ok: false, reason: `HASH_NOT_SELF_CONSISTENT(${recomputed}!=${payload.stateHash})` };
  }
  return { ok: true, snapshot };
}
