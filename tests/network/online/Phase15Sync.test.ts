import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FireCommand } from '../../../src/game/commands/GameCommand';
import { NetworkMessageType } from '../../../src/game/network/NetworkMessageType';
import { OnlineSyncState } from '../../../src/game/network/online/sync/OnlineSyncState';
import { computeStateHash } from '../../../src/game/network/online/AuthoritativeState';
import type {
  StateSyncRequestPayload,
} from '../../../src/game/network/online/OnlineTypes';
import {
  createOnlineHarness,
  flushLoopback,
  type OnlineHarness,
} from '../onlineHarness';

/**
 * Phase 15 通道层同步流程（loopback 双端真实协调器）：
 * Guest 恢复链（HASH_MISMATCH / MISSING_TURN_RESULT / INVALID_LOCAL_STATE）
 * + Host ACK Barrier（TURN_RESULT → ACK → TURN_END；超时阶梯 → SYNC_FAILED）
 * + 快照恢复闭环 + 输入锁 + 终局确认 gate。
 */

let h: OnlineHarness;

beforeEach(async () => {
  h = await createOnlineHarness();
});

afterEach(() => {
  h.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** P1 回合发射（harness FIRE 既有参数：startY=912 为 P1 炮塔） */
function hostFire(turnId: number): void {
  const fire: FireCommand = {
    type: 'FIRE',
    playerId: 'P1',
    turnId,
    weaponId: 'normal',
    startX: 550,
    startY: 912,
    velocityX: 1600,
    velocityY: -1600,
    seed: 7,
  };
  h.hostCoord.inputBus.dispatch(fire);
}

/** Guest spy 捕获最近一条 Guest → Host 消息（loopback 无直接监听口，用 nm send spy） */
function spyGuestSend() {
  return vi.spyOn(h.guestNm, 'send');
}

describe('Phase 15 — Turn Sync Barrier（ACK 先到 / 后到）', () => {
  it('① dwell 先于 ACK → waiting；ACK 到达后自动 TURN_END + hostResume 补驱', async () => {
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.hostCoord.notifyTurnResolved(null, null); // 发 TURN_RESULT
    h.guestCoord.onLocalAttackResolved(); // Guest dwell 完成（双条件半边）
    expect(h.hostCoord.onLocalAttackResolved()).toBe('waiting'); // ACK 未到
    await h.flush(); // Guest 应用 + ACK 回 Host → dwellAsked → 自动 TURN_END + resume 补驱

    expect(h.hostResume).toHaveBeenCalledTimes(1);
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestState.turnId).toBe(2);
  });

  it('①b ACK 先到：onLocalAttackResolved 直接 proceed（无补驱）', async () => {
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush(); // ACK 先到（Host 尚未 dwell）
    h.guestCoord.onLocalAttackResolved(); // guest dwell

    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed'); // ACK 已在 → 直接放行
    expect(h.hostResume).not.toHaveBeenCalled(); // 无补驱（场景自驱路径）
    await h.flush();
    expect(h.guestState.currentPlayerId).toBe('P2');
  });
});

describe('Phase 15 — Desync 检测与快照恢复', () => {
  it('② Guest 篡改 turnId → TURN_RESULT hash mismatch → STATE_SYNC_REQUEST(HASH_MISMATCH) + 输入锁', async () => {
    const send = spyGuestSend();
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.guestState.turnId = 5; // 篡改：turnId 是 hash 覆盖且 TURN_RESULT 不覆写的字段

    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush();

    const syncReq = send.mock.calls.find(
      (c) => c[0] === NetworkMessageType.STATE_SYNC_REQUEST,
    );
    expect(syncReq).toBeDefined();
    const payload = syncReq?.[1] as StateSyncRequestPayload;
    expect(payload.reason).toBe('HASH_MISMATCH');
    expect(payload.expectedTurnId).toBe(5);
    expect(payload.localStateHash).not.toBe(payload.authoritativeHash);
    expect(h.guestSetSyncLock).toHaveBeenCalledWith(true);
    // 无 recovered:false 的干净 ACK —— 恢复闭环补发的是 ACK(recovered:true)
    const acks = send.mock.calls.filter((c) => c[0] === NetworkMessageType.TURN_RESULT_ACK);
    expect(acks.length).toBeGreaterThan(0);
    expect((acks[acks.length - 1]?.[1] as { recovered: boolean }).recovered).toBe(true);
  });

  it('③④ 全链恢复：Host 回快照 → Guest apply → parity + recoveryCount=1 + ACK(recovered) + 下一回合继续', async () => {
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.guestState.turnId = 5;
    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush(); // mismatch → request → snapshot → apply → ACK(recovered)

    expect(h.guestState.turnId).toBe(h.hostState.turnId);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1);
    expect(h.guestCoord.syncState).toBe(OnlineSyncState.SYNCED_AFTER_RECOVERY);
    expect(h.guestSetSyncLock).toHaveBeenLastCalledWith(false); // 恢复后解锁

    // 恢复补发的 ACK(recovered:true) 已到 Host → dwell 放行 TURN_END
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(false); // 非终局
    h.guestCoord.onLocalAttackResolved(); // guest dwell
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    await h.flush();

    // 下一回合继续：TURN_END 已送达并应用
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestState.turnId).toBe(2);
  });

  it('⑤ 恢复期间锁输入（setSyncLock true → 恢复后 false）', async () => {
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.guestState.turnId = 5; // turnId：hash 覆盖且 TURN_RESULT 不覆写（唯一可靠篡改面）

    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush();

    const lockCalls = h.guestSetSyncLock.mock.calls.map((c) => c[0]);
    expect(lockCalls[0]).toBe(true);
    expect(lockCalls[lockCalls.length - 1]).toBe(false);
  });

  it('⑦ 重复 STATE_SNAPSHOT 幂等（同 payload 二次投递安全忽略）', async () => {
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.guestState.turnId = 5;
    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush();
    const afterFirst = computeStateHash(h.guestState);
    const recoveries = h.guestCoord.getSyncDiagnostics().recoveryCount;

    // Host 主动再推一次相同快照（模拟 Host 阶梯重发）
    h.hostNm.send(NetworkMessageType.STATE_SNAPSHOT, {
      snapshot: {
        matchId: 'm', seed: 7, turnId: h.hostState.turnId,
        currentPlayerId: h.hostState.currentPlayerId, phase: h.hostState.phase,
        players: h.hostState.players, items: [], gameOver: false, winnerId: null,
      },
      stateHash: computeStateHash(h.hostState),
      generatedAtTurnId: h.hostState.turnId,
    });
    await h.flush();

    // 核心幂等：状态不变（recoveryCount 是"每次成功 apply"的诊断口径，
    // 重复 apply 允许再计 —— 权威状态本身不受影响）
    expect(computeStateHash(h.guestState)).toBe(afterFirst);
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBeGreaterThanOrEqual(recoveries);
  });

  it('⑧ 错 matchId 快照 → validator 拒收不 apply（状态不变 + 有限重试）', async () => {
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.guestState.turnId = 5;
    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush();
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1); // 已用合法快照恢复

    // 错 matchId 快照（直投 loopback 通道）
    const before = computeStateHash(h.guestState);
    h.hostNm.send(NetworkMessageType.STATE_SNAPSHOT, {
      snapshot: {
        matchId: 'WRONG', seed: 7, turnId: 1, currentPlayerId: 'P1',
        phase: 'ACTION', players: h.hostState.players, items: [],
        gameOver: false, winnerId: null,
      },
      stateHash: 'whatever',
      generatedAtTurnId: 1,
    });
    await h.flush();
    expect(computeStateHash(h.guestState)).toBe(before); // 未 apply
  });

  it('⑨ MISSING_TURN_RESULT：TURN_END 先到（无本回合 TURN_RESULT）→ 恢复链不推进', async () => {
    const send = spyGuestSend();
    h.guestCoord.onLocalAttackResolved(); // guest dwell complete
    h.hostNm.setTurnId(1);
    h.hostNm.send(NetworkMessageType.TURN_END, { nextPlayerId: 'P2', nextTurnId: 2 });
    await h.flush();

    expect(h.guestState.turnId).toBe(1); // 未推进
    const syncReq = send.mock.calls.find(
      (c) => c[0] === NetworkMessageType.STATE_SYNC_REQUEST,
    );
    expect(syncReq).toBeDefined();
    expect((syncReq?.[1] as { reason: string }).reason).toBe('MISSING_TURN_RESULT');
    // 恢复链后续（快照 → apply）在 flush 轮内完成
    await h.flush(4);
    expect(h.guestState.turnId).toBe(h.hostState.turnId);
  });

  it('⑩ future TURN_END（envelope.turnId 跳号）→ INVALID_LOCAL_STATE 恢复后 parity', async () => {
    const send = spyGuestSend();
    h.guestCoord.onLocalAttackResolved(); // guest dwell complete
    // 跳号 TURN_END：envelope.turnId=9 远超本地 turnId+1（DataChannel 有序
    // —— 跳号说明本地状态损坏）
    h.hostNm.setTurnId(9);
    h.hostNm.send(NetworkMessageType.TURN_END, { nextPlayerId: 'P2', nextTurnId: 10 });
    await h.flush(6);

    const syncReq = send.mock.calls.find(
      (c) => c[0] === NetworkMessageType.STATE_SYNC_REQUEST,
    );
    expect(syncReq).toBeDefined();
    expect((syncReq?.[1] as StateSyncRequestPayload).reason).toBe('INVALID_LOCAL_STATE');
    // 恢复后 parity（Host 回权威快照 → Guest apply）
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1);
  });

  it('⑪ gameOver：Guest hash 确认终局 → isFinalStateConfirmed + ACK(recovered) + 无 TURN_END', async () => {
    const send = spyGuestSend();
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    // Host 权威终局：P2 阵亡
    h.hostState.players.P2.hp = 0;
    h.hostState.players.P2.isAlive = false;
    h.hostState.gameOver = true;
    h.hostState.winnerId = 'P1';

    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush();

    expect(h.guestState.gameOver).toBe(true);
    expect(h.guestState.winnerId).toBe('P1');
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(true);
    expect(h.hostCoord.isFinalStateConfirmed()).toBe(true); // Host = state.gameOver
    const ack = send.mock.calls.find((c) => c[0] === NetworkMessageType.TURN_RESULT_ACK);
    expect(ack).toBeDefined();
    expect((ack?.[1] as { recovered: boolean }).recovered).toBe(true);
    // 终局无 TURN_END
    const turnEnd = send.mock.calls.find((c) => c[0] === NetworkMessageType.TURN_END);
    expect(turnEnd).toBeUndefined();
    expect(h.hostResume).not.toHaveBeenCalled();
  });

  it('⑫ debugForceDesync 全流程：篡改 → 边界检测 → 恢复 → 干净第二回合 ACK(recovered:false)', async () => {
    // 回合 1：P1 发射（P2 侧被篡改 turnId 制造 desync）
    h.guestCoord.debugForceDesync(); // guestState.turnId += 1
    hostFire(1);
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    await h.flush(2); // FIRE 广播到 Guest（launch 一次）——不推进到 resolve

    // 双端 resolve（正常 TURN_RESULT 流程）
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush(6); // mismatch → 请求 → 快照 → 恢复 → ACK(recovered:true)

    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1);
    expect(h.guestCoord.syncState).toBe(OnlineSyncState.SYNCED_AFTER_RECOVERY);

    // ACK 先到路径：Host dwell 后放行 TURN_END → Guest 推进 P2 回合
    h.guestCoord.onLocalAttackResolved(); // guest dwell
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn(); // Host 本地权威推进（'proceed' 路径的场景等价行为）
    await h.flush(4);
    // END → ACTION（真实场景由相机转场回调驱动；测试手动补）
    h.hostTurn.notifyTurnTransitionComplete();
    h.guestTurn.notifyTurnTransitionComplete();
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestState.turnId).toBe(2);
    expect(h.hostState.currentPlayerId).toBe('P2');
    expect(h.hostState.turnId).toBe(2);

    // 回合 2：P2 干净发射（无篡改）→ hashMatch → ACK(recovered:false)
    const send = spyGuestSend();
    const fire2: FireCommand = {
      type: 'FIRE',
      playerId: 'P2',
      turnId: 2,
      weaponId: 'normal',
      startX: 4450,
      startY: 912,
      velocityX: -1500,
      velocityY: -1500,
      seed: 7,
    };
    h.guestCoord.inputBus.dispatch(fire2);
    await h.flush(4); // FIRE_REQUEST → Host 校验 → 广播 → 双端 launch

    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush(6);

    const acks = send.mock.calls.filter((c) => c[0] === NetworkMessageType.TURN_RESULT_ACK);
    expect(acks.length).toBeGreaterThan(0);
    const lastAck = acks[acks.length - 1]?.[1] as { recovered: boolean };
    expect(lastAck.recovered).toBe(false);
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1); // 第二回合未再恢复

    // 第二回合收口（ACK 先到 → Host dwell → endTurn → Guest 推进 turn3）
    h.guestCoord.onLocalAttackResolved(); // guest dwell
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn();
    await h.flush(4);
    h.hostTurn.notifyTurnTransitionComplete();
    h.guestTurn.notifyTurnTransitionComplete();
    expect(h.guestState.turnId).toBe(3);
    expect(h.hostState.turnId).toBe(3);
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1); // 全程仅一次恢复
  });
});

describe('Phase 15 — 失败收敛', () => {
  it('⑥ Host ACK 超时阶梯（重发 → 快照 → SYNC_FAILED，恰一次 onSyncFailure）', async () => {
    // 先建 harness（握手用真时钟）再 fake timers —— 否则 flushLoopback 死锁
    const hf = await createOnlineHarness({ hostAckTimeoutMs: 50 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      hf.hostTurn.notifyProjectileLaunched();
      hf.hostTurn.notifyProjectileResolved(null);
      hf.hostCoord.notifyTurnResolved(null, null);
      // 消息黑洞：dispose Guest 侧（ACK 永不回）
      hf.guestCoord.dispose();

      expect(hf.hostCoord.onLocalAttackResolved()).toBe('waiting');

      // 超时#1：重发 TURN_RESULT（diagnostics reason 标记）
      await vi.advanceTimersByTimeAsync(50);
      expect(hf.hostCoord.getSyncDiagnostics().lastSyncReason).toContain('ACK_TIMEOUT_RETRY');

      // 超时#2：推 STATE_SNAPSHOT
      await vi.advanceTimersByTimeAsync(50);
      expect(hf.hostCoord.getSyncDiagnostics().lastSyncReason).toContain('ACK_TIMEOUT_PUSH_SNAPSHOT');

      // 超时#3：SYNC_FAILED → onSyncFailure 恰一次
      await vi.advanceTimersByTimeAsync(50);
      expect(hf.hostCoord.syncState).toBe(OnlineSyncState.SYNC_FAILED);
      expect(hf.hostSyncFailure).toHaveBeenCalledTimes(1);
      // 再推进不再触发（去重）
      await vi.advanceTimersByTimeAsync(200);
      expect(hf.hostSyncFailure).toHaveBeenCalledTimes(1);
    } finally {
      hf.dispose();
    }
  });

  it('⑬ Guest 恢复重试上限：连续坏快照 → 有限重试后 SYNC_FAILED（onSyncFailure 恰一次）', async () => {
    const hf = await createOnlineHarness();
    try {
      hf.hostTurn.notifyProjectileLaunched();
      hf.guestTurn.notifyProjectileLaunched();
      hf.hostTurn.notifyProjectileResolved(null);
      hf.guestTurn.notifyProjectileResolved(null);
      hf.guestState.turnId = 5; // 制造 mismatch
      hf.hostCoord.notifyTurnResolved(null, null);
      // Host 侧黑洞：不再回合法快照 —— 手动投坏包驱动 Guest 重试上限
      hf.hostCoord.dispose();
      await flushLoopback(2); // TURN_RESULT 到 Guest → mismatch → SYNC_REQUEST 发出

      const badSnapshot = (n: number) =>
        ({
          snapshot: {
            matchId: `WRONG-${n}`, seed: 7, turnId: 1, currentPlayerId: 'P1',
            phase: 'ACTION', players: hf.hostState.players, items: [],
            gameOver: false, winnerId: null,
          },
          stateHash: 'whatever',
          generatedAtTurnId: 1,
        }) as never;

      // 坏包 #1/#2 → 各触发一次重试 SYNC_REQUEST；坏包 #3 → 放弃 SYNC_FAILED
      for (let i = 1; i <= 3; i++) {
        hf.hostNm.send(NetworkMessageType.STATE_SNAPSHOT, badSnapshot(i));
        await flushLoopback(3);
      }

      expect(hf.guestCoord.syncState).toBe(OnlineSyncState.SYNC_FAILED);
      expect(hf.guestSyncFailure).toHaveBeenCalledTimes(1);
      expect(hf.guestSetSyncLock).toHaveBeenLastCalledWith(true); // 失败保持锁死
    } finally {
      hf.dispose();
    }
  });
});
