import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessageType } from '../../../src/game/network/NetworkMessageType';
import {
  buildSnapshot,
  computeStateHash,
} from '../../../src/game/network/online/AuthoritativeState';
import { OnlineSyncState } from '../../../src/game/network/online/sync/OnlineSyncState';
import { TurnPhase } from '../../../src/game/state/TurnPhase';
import { createOnlineHarness, type OnlineHarness } from '../onlineHarness';

let h: OnlineHarness;

beforeEach(async () => {
  h = await createOnlineHarness();
});

afterEach(() => {
  h.dispose();
  vi.restoreAllMocks();
});

async function confirmResolvedTurn(): Promise<void> {
  h.hostTurn.notifyProjectileLaunched();
  h.guestTurn.notifyProjectileLaunched();
  h.hostTurn.notifyProjectileResolved(null);
  h.guestTurn.notifyProjectileResolved(null);
  h.hostCoord.notifyTurnResolved(null, null);
  await h.flush();
}

/** Scene 的 END 相机转场完成后只推进表现相位，不改回合归属。 */
function wirePresentationRecovery(): void {
  h.guestSnapshotApplied.mockImplementation((snapshot) => {
    if (snapshot.phase === TurnPhase.END) {
      h.guestTurn.notifyTurnTransitionComplete();
    }
  });
}

describe('Snapshot 恢复与已发出的 TURN_END 竞态', () => {
  it.each([TurnPhase.END, TurnPhase.ACTION])(
    '%s 快照补恢复表现，Guest 无需等已消费的 TURN_END 重发',
    async (hostPhase) => {
      wirePresentationRecovery();
      await confirmResolvedTurn();
      expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
      h.hostTurn.endTurn();
      if (hostPhase === TurnPhase.ACTION) {
        h.hostTurn.notifyTurnTransitionComplete();
      }

      // TURN_END 已发但尚未投递，恢复在途会消费该包。
      h.guestCoord.requestPostReconnectSync();
      await h.flush(8);
      h.hostTurn.notifyTurnTransitionComplete();

      expect(h.guestState.turnId).toBe(2);
      expect(h.guestState.currentPlayerId).toBe('P2');
      expect(h.guestState.phase).toBe(TurnPhase.ACTION);
      expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
      expect(h.guestSnapshotApplied.mock.calls[0]?.[0].phase).toBe(hostPhase);
      expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
      expect(h.guestCoord.syncState).toBe(OnlineSyncState.SYNCED_AFTER_RECOVERY);
      expect(h.guestResume).not.toHaveBeenCalled();
      expect(h.guestSyncFailure).not.toHaveBeenCalled();
    },
  );

  it('同一 END 快照以新 sequence 重推时，不回退 ACTION 或重复转场；ACK 在表现回调前发送', async () => {
    wirePresentationRecovery();
    await confirmResolvedTurn();
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn();
    const snapshot = buildSnapshot(h.hostState);
    const stateHash = computeStateHash(h.hostState);
    const guestSend = vi.spyOn(h.guestNm, 'send');
    h.guestCoord.requestPostReconnectSync();
    await h.flush(8);
    h.hostTurn.notifyTurnTransitionComplete();

    h.hostNm.send(NetworkMessageType.STATE_SNAPSHOT, {
      snapshot,
      stateHash,
      generatedAtTurnId: snapshot.turnId,
    });
    await h.flush();

    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    const firstAckIndex = guestSend.mock.calls.findIndex(
      ([type]) => type === NetworkMessageType.TURN_RESULT_ACK,
    );
    expect(firstAckIndex).toBeGreaterThanOrEqual(0);
    expect(guestSend.mock.invocationCallOrder[firstAckIndex]).toBeLessThan(
      h.guestSnapshotApplied.mock.invocationCallOrder[0]!,
    );
  });

  it('新恢复 episode 允许重新应用上次相同快照，修复再次损坏的状态', async () => {
    h.guestCoord.requestPostReconnectSync();
    await h.flush();
    h.guestState.players.P1.x += 50;
    h.guestCoord.requestPostReconnectSync();
    await h.flush();

    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(2);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    expect(h.guestSetSyncLock).toHaveBeenLastCalledWith(false);
  });

  it('validator 重试返回上次相同快照时，仍然完成恢复', async () => {
    h.guestCoord.requestPostReconnectSync();
    await h.flush();
    h.hostNm.send(NetworkMessageType.STATE_SNAPSHOT, {
      snapshot: buildSnapshot(h.hostState),
      stateHash: 'INVALID_HASH',
      generatedAtTurnId: h.hostState.turnId,
    });
    await h.flush(8);

    expect(h.guestCoord.syncState).toBe(OnlineSyncState.SYNCED_AFTER_RECOVERY);
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(2);
    expect(h.guestSyncFailure).not.toHaveBeenCalled();
  });
});

describe('Snapshot 恢复保留原有回合与终局门禁', () => {
  it('同回合 RESOLVE 快照继续等待 Host TURN_END，之后正常进入下一回合', async () => {
    wirePresentationRecovery();
    await confirmResolvedTurn();
    h.guestCoord.requestPostReconnectSync();
    await h.flush();

    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestSnapshotApplied.mock.calls[0]?.[0].phase).toBe(TurnPhase.RESOLVE);
    expect(h.guestState.phase).toBe(TurnPhase.RESOLVE);
    expect(h.guestState.turnId).toBe(1);
    expect(h.guestResume).not.toHaveBeenCalled();

    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn();
    await h.flush();

    expect(h.guestState.turnId).toBe(2);
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestResume).toHaveBeenCalledTimes(1);
  });

  it('GAME_OVER 快照确认终局，不转到下一回合', async () => {
    wirePresentationRecovery();
    h.hostState.players.P2.hp = 0;
    h.hostState.players.P2.isAlive = false;
    h.hostState.gameOver = true;
    h.hostState.winnerId = 'P1';
    h.hostState.phase = TurnPhase.GAME_OVER;
    h.guestCoord.requestPostReconnectSync();
    await h.flush();

    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestSnapshotApplied.mock.calls[0]?.[0].phase).toBe(TurnPhase.GAME_OVER);
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(true);
    expect(h.guestState.winnerId).toBe('P1');
    expect(h.guestState.turnId).toBe(1);
    expect(h.guestState.phase).toBe(TurnPhase.GAME_OVER);
    expect(h.guestResume).not.toHaveBeenCalled();
  });
});
