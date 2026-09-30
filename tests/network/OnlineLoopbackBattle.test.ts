import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { describe, expect, it } from 'vitest';
import { createOnlineHarness, type OnlineHarness } from './onlineHarness';
import { computeStateHash } from '../../src/game/network/online/AuthoritativeState';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import { TurnPhase } from '../../src/game/state/TurnPhase';

/**
 * Phase 14 双端集成测试（Two-Peer Integration，用户规格）：
 * LocalLoopbackTransport 连接 Host / Guest 两套完整协调器 + 真实系统，
 * 模拟场景事件推进完整循环：
 *
 *   GAME_START → P1 回合（Host 移动+发炮）→ 权威结算 → TURN_END
 *   → P2 回合（Guest 移动+发炮，全程经 Host 校验）→ 权威结算 → TURN_END
 *   → P1 回合 3 ACTION —— 双端 GameState hash 级全等。
 *
 * 覆盖验收：Host Move 双方可见 / Guest Move 经 Host 验证 /
 * Host/Guest Fire 双方可见 / 权威 Damage 生效 / 双端 HP 一致 /
 * 回合由 Host 控制 / P1→P2→P1 完整循环。
 */

describe('Online Loopback 双端完整对局（Phase 14 集成）', () => {
  it('P1 → P2 → P1 完整循环：双端 GameState 最终 hash 级一致', async () => {
    const h: OnlineHarness = await createOnlineHarness();

    // ---------- P1 Turn 1（Host 回合）----------
    expect(h.hostState.currentPlayerId).toBe('P1');
    expect(h.hostCoord.isLocalTurn()).toBe(true);
    expect(h.guestCoord.isLocalTurn()).toBe(false);

    // Host 移动 100px：本地权威执行 → 广播 → Guest 同步
    h.hostCoord.inputBus.dispatch({
      type: 'MOVE',
      playerId: 'P1',
      turnId: 1,
      targetX: 550,
    });
    await h.flush();
    expect(h.hostState.players.P1.x).toBe(550);
    expect(h.guestState.players.P1.x).toBe(550);
    expect(h.guestState.players.P1.moveRemaining).toBe(150);

    // Host 开火：双端各恰一次 launch
    const fire1: FireCommand = {
      type: 'FIRE',
      playerId: 'P1',
      turnId: 1,
      weaponId: 'normal',
      startX: 550,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: 1600,
      velocityY: -1600,
      seed: 7,
    };
    h.hostCoord.inputBus.dispatch(fire1);
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    await h.flush();
    expect(h.guestLaunch).toHaveBeenCalledTimes(1);
    expect(h.guestState.players.P1.hasFired).toBe(true);

    // 场景等效：双方 PROJECTILE → Host 结算（直伤命中 P2）
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    const explosion1 = {
      sourcePlayerId: 'P1' as const,
      weaponId: 'normal' as const,
      x: 4550,
      y: 920,
      radius: 140,
      turnId: 1,
    };
    const result1 = h.hostCoord.damageSystem.calculate(h.hostState, explosion1);
    h.hostCoord.damageSystem.apply(h.hostState, result1);
    h.hostTurn.notifyProjectileResolved(result1);
    h.hostCoord.notifyTurnResolved(
      { x: 4550, y: 920, ownerId: 'P1', weaponId: 'normal', turnId: 1 },
      result1,
    );
    // Guest 本地结算（预测 impact 偏移 → calculate-only，不改状态）
    const local1 = h.guestCoord.damageSystem.calculate(h.guestState, {
      ...explosion1,
      x: 4700,
    });
    h.guestTurn.notifyProjectileResolved(local1);
    h.guestCoord.notifyTurnResolved(
      { x: 4700, y: 920, ownerId: 'P1', weaponId: 'normal', turnId: 1 },
      local1,
    );
    await h.flush();

    // 权威伤害：双端 P2 HP = 8；Guest 数字展示用 Host 值（-2）
    expect(h.hostState.players.P2.hp).toBe(8);
    expect(h.guestState.players.P2.hp).toBe(8);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(
      h.guestShowDamage.mock.calls[0]?.[0].players.find((p) => p.playerId === 'P2')
        ?.damage,
    ).toBe(2);
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);

    // Turn Barrier（A 序：Guest dwell 先完成）：未获 TURN_END 不推进
    expect(h.guestCoord.onLocalAttackResolved()).toBe('waiting');
    expect(h.guestState.currentPlayerId).toBe('P1');
    expect(h.guestState.turnId).toBe(1);
    // Host dwell → TURN_END → Guest 推进；Host 本地权威 endTurn
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn();
    await h.flush();
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestState.turnId).toBe(2);
    expect(h.guestState.players.P2.moveRemaining).toBe(250);
    expect(h.guestResume).toHaveBeenCalledTimes(1);
    // 双端进入 P2 回合 ACTION
    h.hostTurn.notifyTurnTransitionComplete();
    h.guestTurn.notifyTurnTransitionComplete();
    expect(h.hostState.phase).toBe(TurnPhase.ACTION);
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);

    // ---------- P2 Turn 2（Guest 回合）----------
    expect(h.hostCoord.isLocalTurn()).toBe(false);
    expect(h.guestCoord.isLocalTurn()).toBe(true);

    // Guest 单帧移动24px：MOVE_REQUEST → Host 校验执行 → 权威 MOVE → 双端一致
    h.guestCoord.inputBus.dispatch({
      type: 'MOVE',
      playerId: 'P2',
      turnId: 2,
      targetX: 4526,
    });
    await h.flush();
    expect(h.hostState.players.P2.x).toBe(4526);
    expect(h.guestState.players.P2.x).toBe(4526);
    expect(h.hostState.players.P2.moveRemaining).toBe(226);
    expect(h.guestState.players.P2.moveRemaining).toBe(226);

    // Guest 开火：FIRE_REQUEST → Host 校验 → 广播 → 双端各再 launch 一次
    const fire2: FireCommand = {
      type: 'FIRE',
      playerId: 'P2',
      turnId: 2,
      weaponId: 'normal',
      startX: 4526,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: -1500,
      velocityY: -1500,
      seed: 7,
    };
    h.guestCoord.inputBus.dispatch(fire2);
    await h.flush();
    expect(h.hostLaunch).toHaveBeenCalledTimes(2);
    expect(h.guestLaunch).toHaveBeenCalledTimes(2);
    expect(h.hostState.players.P2.hasFired).toBe(true);
    expect(h.guestState.players.P2.hasFired).toBe(true);

    // 双方 PROJECTILE；Host 结算直伤命中 P1
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    const explosion2 = {
      sourcePlayerId: 'P2' as const,
      weaponId: 'normal' as const,
      x: 550,
      y: 920,
      radius: 140,
      turnId: 2,
    };
    const result2 = h.hostCoord.damageSystem.calculate(h.hostState, explosion2);
    h.hostCoord.damageSystem.apply(h.hostState, result2);
    h.hostTurn.notifyProjectileResolved(result2);
    h.hostCoord.notifyTurnResolved(
      { x: 550, y: 920, ownerId: 'P2', weaponId: 'normal', turnId: 2 },
      result2,
    );
    const local2 = h.guestCoord.damageSystem.calculate(h.guestState, {
      ...explosion2,
      x: 540,
    });
    h.guestTurn.notifyProjectileResolved(local2);
    h.guestCoord.notifyTurnResolved(
      { x: 540, y: 920, ownerId: 'P2', weaponId: 'normal', turnId: 2 },
      local2,
    );
    await h.flush();

    // 双端 P1 HP = 8（第二回合权威伤害）
    expect(h.hostState.players.P1.hp).toBe(8);
    expect(h.guestState.players.P1.hp).toBe(8);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(2);

    // Turn Barrier（B 序：Host 先发 TURN_END，Guest dwell 后完成）
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn(); // Host 本地权威推进到 P1 Turn 3
    await h.flush();
    // TURN_END 已到但 Guest dwell 未完成：回合未推进（Host 永远控制切换）
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestResume).toHaveBeenCalledTimes(1);
    expect(h.guestCoord.onLocalAttackResolved()).toBe('proceed');
    expect(h.guestState.currentPlayerId).toBe('P1');
    expect(h.guestState.turnId).toBe(3);
    expect(h.guestResume).toHaveBeenCalledTimes(2);

    // 双端进入 P1 Turn 3 ACTION
    h.hostTurn.notifyTurnTransitionComplete();
    h.guestTurn.notifyTurnTransitionComplete();
    expect(h.hostState.phase).toBe(TurnPhase.ACTION);
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);

    // ---------- 终局一致性：hash 级全等 ----------
    expect(h.hostState.currentPlayerId).toBe('P1');
    expect(h.guestState.currentPlayerId).toBe('P1');
    expect(h.hostState.turnId).toBe(3);
    expect(h.guestState.turnId).toBe(3);
    expect(h.hostState.players.P1.hp).toBe(8);
    expect(h.guestState.players.P1.hp).toBe(8);
    expect(h.hostState.players.P2.hp).toBe(8);
    expect(h.guestState.players.P2.hp).toBe(8);
    expect(computeStateHash(h.hostState)).toBe(computeStateHash(h.guestState));
    h.dispose();
  });

  it('拒绝计数与诊断快照口径：Host 计数 / Guest 零回执', async () => {
    const h = await createOnlineHarness();
    // 伪造 playerId 的 MOVE_REQUEST → Host 回执 → rejectedCount 计在 Host
    h.guestNm.setTurnId(1);
    h.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P1', targetX: 600 });
    await h.flush();
    expect(h.guestRejected).toHaveBeenCalledTimes(1);
    expect(h.hostCoord.debugInfo().rejectedCount).toBe(1);
    expect(h.guestCoord.debugInfo().rejectedCount).toBe(0); // Guest 不发回执
    expect(h.hostCoord.debugInfo().lastRxType).toBe('MOVE_REQUEST');
    expect(h.guestCoord.debugInfo().lastRxType).toBe('COMMAND_REJECTED');
    h.dispose();
  });
});
