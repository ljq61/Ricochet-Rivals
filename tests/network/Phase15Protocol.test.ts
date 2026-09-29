import { describe, expect, it } from 'vitest';
import { createInitialGameState, type GameState } from '../../src/game/state/GameState';
import { TurnPhase } from '../../src/game/state/TurnPhase';
import {
  applyAuthoritativeSnapshot,
  buildSnapshot,
  computeStateHash,
  normalizePosition,
  STATE_HASH_VERSION,
} from '../../src/game/network/online/AuthoritativeState';
import {
  isStateSnapshotPayload,
  isStateSyncRequestPayload,
  isTurnResultAckPayload,
} from '../../src/game/network/online/OnlinePayloads';
import {
  validateAuthoritativeSnapshot,
} from '../../src/game/network/online/sync/SnapshotValidator';
import type {
  StateSnapshotPayload,
  StateSyncRequestPayload,
  TurnResultAckPayload,
} from '../../src/game/network/online/OnlineTypes';

/**
 * Phase 15 协议层纯函数验收（任务清单 §1–8 / §20–22 部分）：
 * 归一化 hash / 快照语义校验 / 原子快照应用 / sync payload 守卫。
 */

const MATCH_ID = 'match-p15';

function makeState(): GameState {
  const state = createInitialGameState({ matchId: MATCH_ID, seed: 42 });
  state.phase = TurnPhase.RESOLVE;
  state.turnId = 3;
  state.currentPlayerId = 'P2';
  state.players.P1.x = 450.001;
  state.players.P2.hp = 8;
  state.players.P2.hasFired = true;
  return state;
}

function makeSnapshotPayload(state: GameState): StateSnapshotPayload {
  const snapshot = buildSnapshot(state);
  return {
    snapshot,
    stateHash: computeStateHash(state),
    generatedAtTurnId: state.turnId,
  };
}

describe('Phase 15 — normalizePosition', () => {
  it('0.01 精度归一：微差折叠为同一值，跨越阈值则不同', () => {
    expect(normalizePosition(450.00000001)).toBe(450);
    expect(normalizePosition(449.99999998)).toBe(450);
    expect(normalizePosition(450.004)).toBe(450);
    expect(normalizePosition(450.006)).toBe(450.01);
    // 负值：-12.34 与 -12.33 之间按 round 语义折叠（浮点 *100 的
    // 表示误差属实现固有，归一化目标只保证"微差不触发 desync"）
    expect(normalizePosition(-12.34)).toBe(-12.34);
    expect(normalizePosition(-12.34000001)).toBe(-12.34);
  });
});

describe('Phase 15 — computeStateHash v2', () => {
  it('① 确定性 + 8 位十六进制 + v2 前缀契约', () => {
    const state = makeState();
    const a = computeStateHash(state);
    expect(a).toBe(computeStateHash(state));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(STATE_HASH_VERSION).toBe('v2');
  });

  it('② 浮点微差（<0.01）→ hash 相同（不触发假 desync）', () => {
    const a = makeState();
    const b = makeState();
    b.players.P1.x = a.players.P1.x + 0.0000005;
    b.players.P2.x = a.players.P2.x - 0.0000004;
    expect(computeStateHash(a)).toBe(computeStateHash(b));
  });

  it('③ 有意义位置差（≥0.01）→ hash 不同', () => {
    const a = makeState();
    const b = makeState();
    b.players.P1.x += 0.02;
    expect(computeStateHash(a)).not.toBe(computeStateHash(b));
  });

  it('④ HP / 有意义位置 / turnId 变化 → hash 不同（敏感性保持）', () => {
    const base = makeState();
    const hpChanged = makeState();
    hpChanged.players.P2.hp = 7;
    expect(computeStateHash(hpChanged)).not.toBe(computeStateHash(base));

    const posChanged = makeState();
    posChanged.players.P1.x = 500;
    expect(computeStateHash(posChanged)).not.toBe(computeStateHash(base));

    const turnChanged = makeState();
    turnChanged.turnId = 4;
    expect(computeStateHash(turnChanged)).not.toBe(computeStateHash(base));
  });

  it('⑤ 对象键序无关（P1/P2 交换构建序）+ items 变化不影响 hash（V0.1 决策）', () => {
    const a = makeState();
    const b = makeState();
    // 交换 players 记录的属性构建顺序（同键不同序）
    (b as { players: Record<string, unknown> }).players = {
      P2: { ...b.players.P2 },
      P1: { ...b.players.P1 },
    } as GameState['players'];
    expect(computeStateHash(a)).toBe(computeStateHash(b));

    // items 不在 hash 覆盖内（Phase 14 决策，Phase 17 复评）
    const withItems = makeState();
    withItems.items.push({ id: 'item-1' } as GameState['items'][number]);
    expect(computeStateHash(withItems)).toBe(computeStateHash(makeState()));
  });
});

describe('Phase 15 — validateAuthoritativeSnapshot', () => {
  it('① 合法快照通过并回传 snapshot', () => {
    const payload = makeSnapshotPayload(makeState());
    const result = validateAuthoritativeSnapshot(payload, { expectedMatchId: MATCH_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.turnId).toBe(3);
    }
  });

  it('② matchId 不符 → 拒', () => {
    const payload = makeSnapshotPayload(makeState());
    const result = validateAuthoritativeSnapshot(payload, { expectedMatchId: 'other-match' });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('MATCH_ID_MISMATCH') });
  });

  it('③ 畸形 payload（缺字段 / 非对象 / hash 空）→ SNAPSHOT_MALFORMED', () => {
    expect(validateAuthoritativeSnapshot(null, { expectedMatchId: MATCH_ID })).toMatchObject({ ok: false, reason: 'SNAPSHOT_MALFORMED' });
    expect(validateAuthoritativeSnapshot({}, { expectedMatchId: MATCH_ID })).toMatchObject({ ok: false, reason: 'SNAPSHOT_MALFORMED' });
    const bad = { ...makeSnapshotPayload(makeState()), stateHash: '' };
    expect(validateAuthoritativeSnapshot(bad, { expectedMatchId: MATCH_ID })).toMatchObject({ ok: false, reason: 'SNAPSHOT_MALFORMED' });
  });

  it('④ 非法 turnId → 拒；非法 phase 由形状守卫（isTurnPhaseValue）在第一道防线拦截', () => {
    const state = makeState();
    const badTurn = makeSnapshotPayload(state);
    (badTurn.snapshot as { turnId: number }).turnId = 0;
    expect(validateAuthoritativeSnapshot(badTurn, { expectedMatchId: MATCH_ID })).toMatchObject({ ok: false, reason: expect.stringContaining('BAD_TURN_ID') });

    // 非法 phase 值过不了 isStateSnapshotPayload 的形状守卫 → SNAPSHOT_MALFORMED
    //（语义校验器的 BAD_PHASE 分支防御 turnId 合法但 phase 漂移的未来形状变化）
    const badPhase = makeSnapshotPayload(state);
    (badPhase.snapshot as { phase: string }).phase = 'NOT_A_PHASE';
    expect(validateAuthoritativeSnapshot(badPhase, { expectedMatchId: MATCH_ID })).toMatchObject({ ok: false, reason: 'SNAPSHOT_MALFORMED' });
  });

  it('⑤ hp 越界 / moveRemaining 为负 → 拒', () => {
    const state = makeState();
    const hpBad = makeSnapshotPayload(state);
    (hpBad.snapshot.players.P1 as { hp: number }).hp = 99;
    // 注意：hp 越界同时破坏 hash 自洽 —— 先断言 hp 检查（顺序在自洽前）
    const r1 = validateAuthoritativeSnapshot(hpBad, { expectedMatchId: MATCH_ID });
    expect(r1).toMatchObject({ ok: false, reason: expect.stringContaining('HP_OUT_OF_RANGE') });

    const mrBad = makeSnapshotPayload(state);
    (mrBad.snapshot.players.P2 as { moveRemaining: number }).moveRemaining = -1;
    const r2 = validateAuthoritativeSnapshot(mrBad, { expectedMatchId: MATCH_ID });
    expect(r2).toMatchObject({ ok: false, reason: expect.stringContaining('MOVE_REMAINING_INVALID') });
  });

  it('⑥ gameOver=false 却带 winnerId → 拒', () => {
    const state = makeState();
    state.gameOver = false;
    state.winnerId = 'P1';
    const payload = makeSnapshotPayload(state); // hash 用篡改后的 state 计算（自洽）
    const result = validateAuthoritativeSnapshot(payload, { expectedMatchId: MATCH_ID });
    expect(result).toMatchObject({ ok: false, reason: 'WINNER_WITHOUT_GAME_OVER' });
  });

  it('⑦ gameOver=true + winnerId=null（平局）→ 通过', () => {
    const state = makeState();
    state.gameOver = true;
    state.winnerId = null;
    const payload = makeSnapshotPayload(state);
    const result = validateAuthoritativeSnapshot(payload, { expectedMatchId: MATCH_ID });
    expect(result.ok).toBe(true);
  });

  it('⑧ payload.stateHash 与快照重算不一致（不自洽）→ 拒', () => {
    const payload = makeSnapshotPayload(makeState());
    const tampered = { ...payload, stateHash: 'deadbeef' };
    const result = validateAuthoritativeSnapshot(tampered, { expectedMatchId: MATCH_ID });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('HASH_NOT_SELF_CONSISTENT') });
  });
});

describe('Phase 15 — applyAuthoritativeSnapshot', () => {
  it('① 原地全量恢复（同一引用 / 含 phase / turnId / currentPlayerId / seed）+ 返回复验 hash', () => {
    const snapshotSource = makeState();
    snapshotSource.phase = TurnPhase.ACTION;
    snapshotSource.turnId = 7;
    snapshotSource.currentPlayerId = 'P1';
    snapshotSource.seed = 999;
    snapshotSource.players.P2.hp = 5;
    const payload = makeSnapshotPayload(snapshotSource);

    const guest = makeState(); // guest 本地是错的状态
    guest.players.P2.hp = 99;
    guest.turnId = 1;
    const ref = guest;
    const { stateHash } = applyAuthoritativeSnapshot(guest, payload.snapshot);

    expect(guest).toBe(ref); // 原地
    expect(guest.turnId).toBe(7);
    expect(guest.currentPlayerId).toBe('P1');
    expect(guest.phase).toBe(TurnPhase.ACTION);
    expect(guest.seed).toBe(999);
    expect(guest.players.P2.hp).toBe(5);
    expect(guest.matchId).toBe(MATCH_ID);
    // 复验 hash === Host 快照 hash（恢复成功判定）
    expect(stateHash).toBe(payload.stateHash);
  });

  it('② items 数组保持引用（场景层持有的数组不被替换）', () => {
    const state = makeState();
    const payload = makeSnapshotPayload(state);
    const guest = makeState();
    const itemsRef = guest.items;
    applyAuthoritativeSnapshot(guest, payload.snapshot);
    expect(guest.items).toBe(itemsRef);
    expect(guest.items).toHaveLength(0);
  });
});

describe('Phase 15 — sync payload 守卫', () => {
  const SYNC_REQUEST: StateSyncRequestPayload = {
    expectedTurnId: 3,
    localStateHash: 'aabbccdd',
    authoritativeHash: '11223344',
    reason: 'HASH_MISMATCH',
  };
  const ACK: TurnResultAckPayload = { turnId: 3, stateHash: 'aabbccdd', recovered: false };

  it('① STATE_SYNC_REQUEST 正例 / reason 枚举外拒 / 缺字段拒', () => {
    expect(isStateSyncRequestPayload(SYNC_REQUEST)).toBe(true);
    expect(
      isStateSyncRequestPayload({ ...SYNC_REQUEST, reason: 'NOT_A_REASON' }),
    ).toBe(false);
    expect(
      isStateSyncRequestPayload({ ...SYNC_REQUEST, expectedTurnId: 1.5 }),
    ).toBe(false);
    const { expectedTurnId: _omit, ...missing } = SYNC_REQUEST;
    expect(isStateSyncRequestPayload(missing)).toBe(false);
  });

  it('② 原型链 reason 伪造拒（hasOwnProperty 防线）', () => {
    const forged = { ...SYNC_REQUEST, reason: 'toString' };
    expect(isStateSyncRequestPayload(forged)).toBe(false);
  });

  it('③ STATE_SNAPSHOT 正例 / 缺 snapshot 拒 / 空 hash 拒', () => {
    const payload = makeSnapshotPayload(makeState());
    expect(isStateSnapshotPayload(payload)).toBe(true);
    expect(isStateSnapshotPayload({ ...payload, snapshot: null })).toBe(false);
    expect(isStateSnapshotPayload({ ...payload, stateHash: '' })).toBe(false);
    expect(isStateSnapshotPayload({ ...payload, generatedAtTurnId: 'x' })).toBe(false);
  });

  it('④ TURN_RESULT_ACK 正例 / 非整数 turnId 拒 / 缺 recovered 拒', () => {
    expect(isTurnResultAckPayload(ACK)).toBe(true);
    expect(isTurnResultAckPayload({ ...ACK, turnId: 3.5 })).toBe(false);
    const { recovered: _omit, ...missing } = ACK;
    expect(isTurnResultAckPayload(missing)).toBe(false);
  });
});
