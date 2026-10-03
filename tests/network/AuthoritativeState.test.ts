import { describe, expect, it } from 'vitest';
import {
  applyTurnResult,
  buildSnapshot,
  buildTurnResultPayload,
  computeStateHash,
  stateFromSnapshot,
} from '../../src/game/network/online/AuthoritativeState';
import { isAuthoritativeGameSnapshot, isTurnResultPayload } from '../../src/game/network/online/OnlinePayloads';
import { validateAuthoritativeSnapshot } from '../../src/game/network/online/sync/SnapshotValidator';
import { MovementSystem } from '../../src/game/systems/MovementSystem';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';
import type { GameState } from '../../src/game/state/GameState';
import type { DamageResult } from '../../src/game/state/DamageResult';
import type { ProjectileImpact } from '../../src/game/state/ExplosionEvent';

/**
 * 权威快照层测试（Phase 14）：
 * buildSnapshot → stateFromSnapshot 往返全等与深独立；
 * buildTurnResultPayload（含伤害 / 出界 / gameOver 分支）；
 * applyTurnResult（权威覆写 + hashMatch + 不碰相位推进字段）；
 * computeStateHash（确定性 / 敏感性 / 键序无关 / 排除字段）。
 */

const IMPACT: ProjectileImpact = { x: 4300, y: 920, ownerId: 'P1', weaponId: 'normal', turnId: 1 };

const DAMAGE_RESULT: DamageResult = {
  explosion: {
    sourcePlayerId: 'P1',
    weaponId: 'normal',
    x: 4300,
    y: 920,
    radius: 140,
    turnId: 1,
  },
  players: [
    { playerId: 'P1', distance: 300, damage: 0, hpBefore: 10, hpAfter: 10 },
    { playerId: 'P2', distance: 30, damage: 2, hpBefore: 10, hpAfter: 8 },
  ],
};

/** Host 已 apply 伤害后的权威状态（buildTurnResultPayload 输入） */
function hostResolvedState(): GameState {
  const state = createInitialGameState({ matchId: 'm', seed: 7 });
  state.phase = TurnPhase.RESOLVE;
  state.players.P2.hp = 8;
  state.players.P1.hasFired = true;
  return state;
}

describe('AuthoritativeState（Phase 14）', () => {
  describe('buildSnapshot → stateFromSnapshot 往返', () => {
    it('① 往返全等（逐字段）且产物过快照守卫', () => {
      const state = createInitialGameState({ matchId: 'm', seed: 7 });
      const snapshot = buildSnapshot(state);
      const rebuilt = stateFromSnapshot(snapshot);

      expect(rebuilt).toEqual(state);
      expect(rebuilt.matchId).toBe('m');
      expect(rebuilt.seed).toBe(7);
      expect(rebuilt.turnId).toBe(1);
      expect(rebuilt.currentPlayerId).toBe('P1');
      expect(rebuilt.phase).toBe(TurnPhase.START);
      expect(rebuilt.players.P1.x).toBe(450);
      expect(rebuilt.players.P2.x).toBe(4550);
      expect(rebuilt.gameOver).toBe(false);
    });

    it('② 深独立：重建对象与原状态零共享引用', () => {
      const state = createInitialGameState({ matchId: 'm', seed: 7 });
      const snapshot = buildSnapshot(state);
      const rebuilt = stateFromSnapshot(snapshot);

      expect(snapshot.players.P1).not.toBe(state.players.P1);
      expect(rebuilt.players.P1).not.toBe(state.players.P1);
      expect(rebuilt.players.P1).not.toBe(snapshot.players.P1);
      expect(rebuilt.items).not.toBe(state.items);
      expect(rebuilt.items).not.toBe(snapshot.items);

      // 改 rebuilt 不影响任何一方
      rebuilt.players.P1.hp = 1;
      rebuilt.items.push({ id: 'item-1', type: 'heal', x: 100, y: 100, active: true, spawnTurnId: 3, expiresAtTurnId: 9 });
      expect(state.players.P1.hp).toBe(10);
      expect(snapshot.players.P1.hp).toBe(10);
      expect(state.items).toHaveLength(0);
      expect(snapshot.items).toHaveLength(0);
    });

    it('③ 同回合往返1750px后，JSON快照与结算均保留有限0字段和hash parity', () => {
      const host = createInitialGameState({ matchId: 'm', seed: 7 });
      host.phase = TurnPhase.ACTION;
      const movement = new MovementSystem();
      let travelled = 0;
      for (const targetX of [800, 100, 800]) {
        const result = movement.execute(host, { type: 'MOVE', playerId: 'P1', turnId: 1, targetX });
        expect(result.accepted).toBe(true);
        travelled += result.distanceConsumed;
      }
      expect(travelled).toBe(1750);
      const snapshot: unknown = JSON.parse(JSON.stringify(buildSnapshot(host)));
      expect(isAuthoritativeGameSnapshot(snapshot)).toBe(true);
      if (!isAuthoritativeGameSnapshot(snapshot)) throw new Error('invalid unlimited movement snapshot');
      const stateHash = computeStateHash(host);
      expect(validateAuthoritativeSnapshot({ snapshot, stateHash, generatedAtTurnId: host.turnId }, { expectedMatchId: 'm' }).ok).toBe(true);
      const guest = stateFromSnapshot(snapshot);
      for (const player of Object.values(guest.players)) {
        expect(player.moveRemaining).toBe(0);
        expect(Number.isFinite(player.moveRemaining)).toBe(true);
      }
      expect(computeStateHash(guest)).toBe(stateHash);

      host.phase = guest.phase = TurnPhase.RESOLVE;
      const result: unknown = JSON.parse(JSON.stringify(buildTurnResultPayload(host, null, null)));
      expect(isTurnResultPayload(result)).toBe(true);
      if (!isTurnResultPayload(result)) throw new Error('invalid unlimited movement turn result');
      expect(result.players.P1.moveRemaining).toBe(0);
      expect(result.players.P2.moveRemaining).toBe(0);
      expect(applyTurnResult(guest, result).hashMatch).toBe(true);
    });
  });

  describe('buildTurnResultPayload', () => {
    it('① 带伤害结算：damages / hpBefore / players 快照正确，产物过守卫', () => {
      const payload = buildTurnResultPayload(hostResolvedState(), IMPACT, DAMAGE_RESULT);

      expect(payload.turnId).toBe(1);
      expect(payload.impact).toEqual({ x: 4300, y: 920 });
      expect(payload.damages.P1).toBe(0);
      expect(payload.damages.P2).toBe(2);
      expect(payload.players.P2.hp).toBe(8);
      expect(payload.players.P2.hpBefore).toBe(10);
      expect(payload.players.P1.hasFired).toBe(true);
      expect(payload.gameOver).toBe(false);
      expect(payload.winnerId).toBeNull();
      expect(payload.nextPlayerId).toBe('P2');
      expect(payload.nextTurnId).toBe(2);
      expect(isTurnResultPayload(payload)).toBe(true);
    });

    it('② 出界路径：impact / result 均为 null → damages 全 0、hpBefore 回退当前 hp', () => {
      const payload = buildTurnResultPayload(hostResolvedState(), null, null);

      expect(payload.impact).toBeNull();
      expect(payload.damages.P1).toBe(0);
      expect(payload.damages.P2).toBe(0);
      expect(payload.players.P2.hpBefore).toBe(8); // 回退当前 hp（已 apply 状态）
      expect(isTurnResultPayload(payload)).toBe(true);
    });

    it('③ gameOver：nextPlayerId 为 null（Host 不再发 TURN_END）', () => {
      const state = hostResolvedState();
      state.players.P2.hp = 0;
      state.players.P2.isAlive = false;
      state.gameOver = true;
      state.winnerId = 'P1';

      const payload = buildTurnResultPayload(state, IMPACT, DAMAGE_RESULT);
      expect(payload.gameOver).toBe(true);
      expect(payload.winnerId).toBe('P1');
      expect(payload.nextPlayerId).toBeNull();
      expect(payload.nextTurnId).toBe(2);
    });
  });

  describe('applyTurnResult（Guest reconcile）', () => {
    it('① 权威覆写：hp / 位置 / hasFired 以 Host 为准，hashMatch = true', () => {
      const host = hostResolvedState();
      const payload = buildTurnResultPayload(host, IMPACT, DAMAGE_RESULT);

      // Guest 同源初始状态 + 相位/回合推进方式一致 → 应用后 hash 应一致
      const guest = createInitialGameState({ matchId: 'm', seed: 7 });
      guest.phase = TurnPhase.RESOLVE;
      const { hashMatch } = applyTurnResult(guest, payload);

      expect(guest.players.P2.hp).toBe(8);
      expect(guest.players.P2.x).toBe(host.players.P2.x);
      expect(guest.players.P1.hasFired).toBe(true);
      expect(guest.gameOver).toBe(false);
      expect(hashMatch).toBe(true);
      expect(computeStateHash(guest)).toBe(computeStateHash(host));
    });

    it('② 篡改 stateHash → hashMatch = false（不抛错、不回滚）', () => {
      const host = hostResolvedState();
      const payload = buildTurnResultPayload(host, IMPACT, DAMAGE_RESULT);
      const guest = createInitialGameState({ matchId: 'm', seed: 7 });
      guest.phase = TurnPhase.RESOLVE;

      const tampered = { ...payload, stateHash: 'deadbeef' };
      const { hashMatch } = applyTurnResult(guest, tampered);
      expect(hashMatch).toBe(false);
      // 覆写已生效（Host 权威，不回滚）
      expect(guest.players.P2.hp).toBe(8);
    });

    it('③ 不碰 phase / turnId / currentPlayerId（归 TURN_END 路径）', () => {
      const host = hostResolvedState();
      const payload = buildTurnResultPayload(host, IMPACT, DAMAGE_RESULT);
      const guest = createInitialGameState({ matchId: 'm', seed: 7 });
      guest.phase = TurnPhase.ACTION;
      guest.turnId = 3;
      guest.currentPlayerId = 'P2';

      applyTurnResult(guest, payload);
      expect(guest.phase).toBe(TurnPhase.ACTION);
      expect(guest.turnId).toBe(3);
      expect(guest.currentPlayerId).toBe('P2');
    });
  });

  describe('computeStateHash', () => {
    it('① 确定性：同一状态两次计算相同，格式为 8 位十六进制', () => {
      const state = createInitialGameState({ matchId: 'm', seed: 7 });
      const a = computeStateHash(state);
      const b = computeStateHash(state);
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{8}$/);
    });

    it('② 敏感：hp / x / turnId 任一变化 → hash 变化', () => {
      const base = createInitialGameState({ matchId: 'm', seed: 7 });
      const baseHash = computeStateHash(base);

      const hpChanged = createInitialGameState({ matchId: 'm', seed: 7 });
      hpChanged.players.P1.hp = 9;
      expect(computeStateHash(hpChanged)).not.toBe(baseHash);

      const xChanged = createInitialGameState({ matchId: 'm', seed: 7 });
      xChanged.players.P2.x = 4400;
      expect(computeStateHash(xChanged)).not.toBe(baseHash);

      const turnChanged = createInitialGameState({ matchId: 'm', seed: 7 });
      turnChanged.turnId = 2;
      expect(computeStateHash(turnChanged)).not.toBe(baseHash);
    });

    it('③ 键序无关：players 键构造顺序颠倒 → hash 相同', () => {
      const state = createInitialGameState({ matchId: 'm', seed: 7 });
      const p1 = state.players.P1;
      const p2 = state.players.P2;
      const reversed = {
        ...state,
        players: { P2: p2, P1: p1 },
      };
      expect(computeStateHash(reversed)).toBe(computeStateHash(state));
    });

    it('④ V0.2 identity / items 纳入哈希', () => {
      const a = createInitialGameState({ matchId: 'a', seed: 1 });
      const b = createInitialGameState({ matchId: 'b', seed: 999 });
      expect(computeStateHash(a)).not.toBe(computeStateHash(b));

      const before = computeStateHash(a);
      a.items.push({ id: 'item-1', type: 'heal', x: 100, y: 100, active: true, spawnTurnId: 3, expiresAtTurnId: 9 });
      expect(computeStateHash(a)).not.toBe(before);
    });
  });
});
