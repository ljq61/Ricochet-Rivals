import { GAME_CONFIG } from '../../config/GameConfig';
import type { GameState } from '../../state/GameState';
import type { PlayerState } from '../../state/PlayerState';
import type { WorldItemState } from '../../state/WorldItemState';
import type { DamageResult } from '../../state/DamageResult';
import type { ProjectileImpact } from '../../state/ExplosionEvent';
import { PLAYER_IDS, type PlayerId } from '../../state/ids';
import type {
  AuthoritativeGameSnapshot,
  TurnResultPayload,
  TurnResultPlayerPayload,
} from './OnlineTypes';

/**
 * 权威快照层（Phase 14）—— Host 侧构建 / Guest 侧重建与 reconcile。
 *
 * * wire 类型是 AuthoritativeGameSnapshot（协议层稳定投影）—— 禁止把
 *   GameState 直接当 wire 类型：State 演进不得隐式改变协议形状。
 * * 入参假定已过 OnlinePayloads 对应守卫（JSDoc 逐函数声明）——
 *   守卫是唯一入站防线，本模块不做第二次形状判定。
 * * 纯函数、零 Phaser / DOM / Math.random 依赖；Vitest node 环境可测。
 * * computeStateHash 必须双端字节一致（ECMA-262 Number→string 规范化，
 *   固定键序手工拼接，禁 toLocaleString / JSON.stringify 键序依赖）。
 */

/**
 * Host：GameState → 协议快照（GAME_START.initialState 用）。
 * 入假定：state 为合法 GameState（本地构建，天然可信）。
 * 显式逐字段拷贝（不 spread）—— 保证快照字段集 = 契约字段集，
 * GameState 新增字段不会静默混入 wire。
 */
export function buildSnapshot(state: GameState): AuthoritativeGameSnapshot {
  const players = {} as Record<PlayerId, AuthoritativeGameSnapshot['players'][PlayerId]>;
  for (const playerId of PLAYER_IDS) {
    const p = state.players[playerId];
    players[playerId] = {
      id: p.id,
      side: p.side,
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp,
      isAlive: p.isAlive,
      moveRemaining: p.moveRemaining,
      hasFired: p.hasFired,
      weaponId: p.weaponId,
    };
  }
  return {
    matchId: state.matchId,
    seed: state.seed,
    turnId: state.turnId,
    currentPlayerId: state.currentPlayerId,
    phase: state.phase,
    players,
    items: state.items.map((item) => ({ ...item })),
    gameOver: state.gameOver,
    winnerId: state.winnerId,
  };
}

/**
 * 双向重建：已过 isAuthoritativeGameSnapshot 守卫的快照 → 全新独立
 * GameState（players / items 全部深拷贝，与快照零共享引用）。
 * Guest 的 GAME_START 状态源 —— 禁止自行产生 seed / 初始位置 / 首位玩家。
 */
export function stateFromSnapshot(snapshot: AuthoritativeGameSnapshot): GameState {
  const players = {} as Record<PlayerId, PlayerState>;
  for (const playerId of PLAYER_IDS) {
    const s = snapshot.players[playerId];
    players[playerId] = {
      id: s.id,
      side: s.side,
      x: s.x,
      y: s.y,
      hp: s.hp,
      maxHp: s.maxHp,
      moveRemaining: s.moveRemaining,
      hasFired: s.hasFired,
      isAlive: s.isAlive,
      weaponId: s.weaponId,
    };
  }
  const items: WorldItemState[] = snapshot.items.map((item) => ({ ...item }));
  return {
    matchId: snapshot.matchId,
    seed: snapshot.seed,
    turnId: snapshot.turnId,
    currentPlayerId: snapshot.currentPlayerId,
    phase: snapshot.phase,
    players,
    items,
    gameOver: snapshot.gameOver,
    winnerId: snapshot.winnerId,
  };
}

/**
 * Host：本地结算（ExplosionSystem.explode 已 apply）后构建 TURN_RESULT。
 * * impact = null 表示出界（无爆炸无伤害）；result = null 同上（防御：
 *   出界路径不该传 result，null 保证 damages 全 0 语义）。
 * * damages / hpBefore 从本地 DamageResult 逐玩家提取（无 entry 回退
 *   当前 hp / 0 伤害）；nextPlayerId 在 gameOver 时为 null —— Host 不再
 *   发 TURN_END，Guest 由 update 循环 gameOver 检测接管收口。
 */
export function buildTurnResultPayload(
  state: GameState,
  impact: ProjectileImpact | null,
  result: DamageResult | null,
): TurnResultPayload {
  const players = {} as Record<PlayerId, TurnResultPlayerPayload>;
  const damages = {} as Record<PlayerId, number>;
  for (const playerId of PLAYER_IDS) {
    const p = state.players[playerId];
    const entry = result?.players.find((r) => r.playerId === playerId);
    const damage = entry?.damage ?? 0;
    players[playerId] = {
      x: p.x,
      y: p.y,
      hp: p.hp,
      hpBefore: entry?.hpBefore ?? p.hp,
      isAlive: p.isAlive,
      moveRemaining: p.moveRemaining,
      hasFired: p.hasFired,
    };
    damages[playerId] = damage;
  }
  return {
    turnId: state.turnId,
    impact: impact === null ? null : { x: impact.x, y: impact.y },
    players,
    damages,
    gameOver: state.gameOver,
    winnerId: state.winnerId,
    nextPlayerId: state.gameOver
      ? null
      : state.currentPlayerId === 'P1'
        ? 'P2'
        : 'P1',
    nextTurnId: state.turnId + 1,
    stateHash: computeStateHash(state),
  };
}

/**
 * Guest：权威覆写（TURN_RESULT reconcile）。HP / 位置 / 存活 / 预算 /
 * hasFired / gameOver / winnerId 一律以 Host 为准 —— 不平均、不合并、
 * 不以本地 prediction 为主。phase / currentPlayerId / turnId **不碰**：
 * 它们由 TURN_END 路径（applyRemoteTurnEnd）推进。
 * 返回 hashMatch = 应用后本地重算 hash 与 payload.stateHash 是否一致
 * （仅诊断 —— Phase 14 不消费不回滚；Phase 15 desync 防护用）。
 */
export function applyTurnResult(
  state: GameState,
  payload: TurnResultPayload,
): { hashMatch: boolean } {
  for (const playerId of PLAYER_IDS) {
    const p = state.players[playerId];
    const entry = payload.players[playerId];
    p.x = entry.x;
    p.y = entry.y;
    p.hp = entry.hp;
    p.isAlive = entry.isAlive;
    p.moveRemaining = entry.moveRemaining;
    p.hasFired = entry.hasFired;
  }
  state.gameOver = payload.gameOver;
  state.winnerId = payload.winnerId;
  return { hashMatch: computeStateHash(state) === payload.stateHash };
}

/**
 * Guest：把权威 TURN_RESULT 合成为 DamageResult 形状供伤害数字展示
 * （DamageNumbers 只画 damage>0 的玩家；出界全 0 自然无显示）。
 * 伤害数值 / hpBefore / hpAfter 全部取 Host payload —— 不显示本地预测值。
 * impact 位置优先本地结算点（与本地爆炸 FX 同位），出界双方皆 null。
 */
export function synthesizeAuthoritativeDamage(
  payload: TurnResultPayload,
  localImpact: ProjectileImpact | null,
  remotePlayerId: PlayerId,
): DamageResult {
  const point = localImpact ?? payload.impact;
  return {
    explosion: {
      sourcePlayerId: remotePlayerId,
      weaponId: 'normal',
      x: point === null ? 0 : point.x,
      y: point === null ? 0 : point.y,
      radius: GAME_CONFIG.explosion.radius,
      turnId: payload.turnId,
    },
    players: PLAYER_IDS.map((id) => ({
      playerId: id,
      distance: 0,
      damage: payload.damages[id],
      hpBefore: payload.players[id].hpBefore,
      hpAfter: payload.players[id].hp,
    })),
  };
}

/**
 * 确定性状态哈希（FNV-1a 32 位）。双端必须字节一致：
 * * 手工拼接规范串（PLAYER_IDS 固定序，不受对象键序影响）
 * * 整数取 Math.trunc；hasFired / isAlive / gameOver 以 0/1 表达
 * * 数值经模板字符串（ECMA-262 Number::toString 规范化，双端一致）
 * * 禁 Math.random / toLocaleString / JSON.stringify 键序
 *
 * 不纳入 matchId / seed / items：matchId+seed 已由 GAME_START 锁定双方
 * 同源；items V0.1 恒空（Phase 17 定型后再评估纳入）。
 * 覆盖字段：turnId / currentPlayerId / phase / 每玩家(x,y,hp,isAlive,
 * moveRemaining,hasFired) / gameOver / winnerId。
 */
export function computeStateHash(state: GameState): string {
  const parts: string[] = [
    `turn=${Math.trunc(state.turnId)}`,
    `cur=${state.currentPlayerId}`,
    `phase=${state.phase}`,
  ];
  for (const playerId of PLAYER_IDS) {
    const p = state.players[playerId];
    parts.push(
      `${playerId}:${p.hp},${p.x},${p.y},${p.isAlive ? 1 : 0},${p.moveRemaining},${p.hasFired ? 1 : 0}`,
    );
  }
  parts.push(`over=${state.gameOver ? 1 : 0}`);
  parts.push(`win=${state.winnerId === null ? 'null' : state.winnerId}`);
  const canonical = parts.join('|');

  // FNV-1a 32 位（Math.imul 保持 32 位乘法语义，双端一致）
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
