import { describe, expect, it } from 'vitest';
import {
  isAuthoritativeGameSnapshot,
  isCommandRejectedPayload,
  isDisconnectPayload,
  isFirePayload,
  isFireRequestPayload,
  isGameStartPayload,
  isMovePayload,
  isMoveRequestPayload,
  isPlayerReadyPayload,
  isTurnEndPayload,
  isTurnResultPayload,
} from '../../src/game/network/online/OnlinePayloads';

/**
 * Phase 14 入站 payload 守卫测试：Untrusted Input 第一道防线。
 * 每守卫：合法样本通过 → 多余字段通过（未知键不合并）→ 非对象拒绝 →
 * 逐字段腐蚀拒绝 → 深层腐蚀（gameStart / turnResult）拒绝。
 */

const NON_OBJECTS: ReadonlyArray<[string, unknown]> = [
  ['null', null],
  ['array', []],
  ['string', 'x'],
  ['number', 42],
  ['boolean', true],
  ['undefined', undefined],
];

/** structuredClone 深拷贝后按字段变异 —— 模拟网络逐字段腐蚀 */
function corrupt<T extends object>(sample: T, mutate: (record: Record<string, unknown>) => void): unknown {
  const clone = structuredClone(sample) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

/** 嵌套字段收窄助手（禁 any） */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('test helper: expected plain object');
  }
  return value as Record<string, unknown>;
}

// ---- 合法样本（spread 可选字段，readonly 字段只能新建字面量） ----

const PLAYER_SNAPSHOT_P1 = {
  id: 'P1',
  side: 'left',
  x: 450,
  y: 960,
  hp: 10,
  maxHp: 10,
  isAlive: true,
  moveRemaining: 0,
  hasFired: false,
  weaponId: 'normal',
};

const PLAYER_SNAPSHOT_P2 = {
  ...PLAYER_SNAPSHOT_P1,
  id: 'P2',
  side: 'right',
  x: 4550,
};

const GAME_SNAPSHOT = {
  matchId: 'match-1',
  seed: 42,
  turnId: 1,
  currentPlayerId: 'P1',
  phase: 'START',
  players: { P1: PLAYER_SNAPSHOT_P1, P2: PLAYER_SNAPSHOT_P2 },
  items: [] as unknown[],
  octopus: { hp: 15, spawnTurnId: null, lastResolvedTurnId: 0, lastAttackTurnId: null, lastAttackTarget: null },
  gameOver: false,
  winnerId: null,
};

const GAME_START = {
  matchId: 'match-1',
  seed: 42,
  hostPlayerId: 'P1',
  guestPlayerId: 'P2',
  initialState: GAME_SNAPSHOT,
};

const TURN_RESULT_PLAYERS = {
  P1: { x: 450, y: 960, hp: 10, hpBefore: 10, isAlive: true, moveRemaining: 0, hasFired: true },
  P2: { x: 4550, y: 960, hp: 8, hpBefore: 10, isAlive: true, moveRemaining: 0, hasFired: false },
};

const TURN_RESULT = {
  turnId: 1,
  impact: { x: 4000, y: 900 },
  players: TURN_RESULT_PLAYERS,
  damages: { P1: 0, P2: 2 },
  octopus: { hp: 15, spawnTurnId: null, lastResolvedTurnId: 1, lastAttackTurnId: null, lastAttackTarget: null },
  gameOver: false,
  winnerId: null,
  nextPlayerId: 'P2',
  nextTurnId: 2,
  stateHash: '1a2b3c4d',
};

// ---------------------------------------------------------------------------

describe('OnlinePayloads 守卫（Phase 14）', () => {
  describe('isPlayerReadyPayload', () => {
    it('① 合法样本通过；多余字段不拒绝', () => {
      expect(isPlayerReadyPayload({ readyAt: 1690000000000 })).toBe(true);
      expect(isPlayerReadyPayload({ readyAt: 1, extra: 'unknown' })).toBe(true);
    });

    it.each(NON_OBJECTS)('② 非对象拒绝（%s）', (_label, value) => {
      expect(isPlayerReadyPayload(value)).toBe(false);
    });

    it('③ 字段腐蚀：readyAt 非整数 / NaN / 缺失 → 拒绝', () => {
      expect(isPlayerReadyPayload(corrupt({ readyAt: 1 }, (r) => { r.readyAt = 1.5; }))).toBe(false);
      expect(isPlayerReadyPayload(corrupt({ readyAt: 1 }, (r) => { r.readyAt = Number.NaN; }))).toBe(false);
      expect(isPlayerReadyPayload(corrupt({ readyAt: 1 }, (r) => { delete r.readyAt; }))).toBe(false);
    });
  });

  describe('isGameStartPayload（深校验 initialState）', () => {
    it('① 合法样本通过；多余字段不拒绝', () => {
      expect(isGameStartPayload(GAME_START)).toBe(true);
      expect(isGameStartPayload({ ...GAME_START, extra: 1 })).toBe(true);
    });

    it.each(NON_OBJECTS)('② 非对象拒绝（%s）', (_label, value) => {
      expect(isGameStartPayload(value)).toBe(false);
    });

    it('③ 顶层字段腐蚀', () => {
      expect(isGameStartPayload(corrupt(GAME_START, (r) => { r.matchId = ''; }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => { r.seed = 1.5; }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => { r.seed = Number.POSITIVE_INFINITY; }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => { r.hostPlayerId = 'P2'; }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => { r.guestPlayerId = 'P1'; }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => { delete r.initialState; }))).toBe(false);
    });

    it('④ 深层腐蚀：initialState 缺 P2 → 拒绝', () => {
      const bad = corrupt(GAME_START, (r) => {
        delete record(record(r.initialState).players).P2;
      });
      expect(isGameStartPayload(bad)).toBe(false);
    });

    it('⑤ 深层腐蚀：phase 非法值 / players.P1 缺 hp / side / weaponId 腐蚀 → 拒绝', () => {
      expect(isGameStartPayload(corrupt(GAME_START, (r) => {
        record(r.initialState).phase = 'NOT_A_PHASE';
      }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => {
        delete record(record(record(r.initialState).players).P1).hp;
      }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => {
        record(record(record(r.initialState).players).P1).side = 'up';
      }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => {
        record(record(record(r.initialState).players).P1).weaponId = 'laser';
      }))).toBe(false);
      expect(isGameStartPayload(corrupt(GAME_START, (r) => {
        record(r.initialState).gameOver = 'yes';
      }))).toBe(false);
    });
  });

  describe('isMoveRequestPayload / isMovePayload', () => {
    it('① MOVE_REQUEST 合法通过；targetX 腐蚀拒绝', () => {
      expect(isMoveRequestPayload({ playerId: 'P2', targetX: 500 })).toBe(true);
      expect(isMoveRequestPayload(corrupt({ playerId: 'P2', targetX: 500 }, (r) => { r.targetX = Number.NaN; }))).toBe(false);
      expect(isMoveRequestPayload(corrupt({ playerId: 'P2', targetX: 500 }, (r) => { r.playerId = 'P3'; }))).toBe(false);
      expect(isMoveRequestPayload(corrupt({ playerId: 'P2', targetX: 500 }, (r) => { r.targetX = '500'; }))).toBe(false);
    });

    it('帧增量 finite 必须合法；缺失/畸形增量不能借旧 targetX 绕过', () => {
      expect(isMoveRequestPayload({ playerId: 'P2', deltaX: -5 })).toBe(true);
      expect(isMoveRequestPayload({ playerId: 'P2', deltaX: 0 })).toBe(true);
      expect(isMoveRequestPayload({ playerId: 'P2' })).toBe(false);
      expect(isMoveRequestPayload({ playerId: 'P2', deltaX: Infinity })).toBe(false);
      expect(isMoveRequestPayload({ playerId: 'P2', deltaX: NaN, targetX: 500 })).toBe(false);
    });

    it('② MOVE 合法通过；x / moveRemaining 腐蚀拒绝', () => {
      expect(isMovePayload({ playerId: 'P2', x: 500, moveRemaining: 0 })).toBe(true);
      expect(isMovePayload({ playerId: 'P2', x: 500, moveRemaining: 100 })).toBe(true);
      expect(isMovePayload(corrupt({ playerId: 'P2', x: 500, moveRemaining: 100 }, (r) => { r.moveRemaining = Number.POSITIVE_INFINITY; }))).toBe(false);
      expect(isMovePayload(corrupt({ playerId: 'P2', x: 500, moveRemaining: 100 }, (r) => { delete r.x; }))).toBe(false);
    });

    it.each(NON_OBJECTS)('③ 非对象拒绝（%s）', (_label, value) => {
      expect(isMoveRequestPayload(value)).toBe(false);
      expect(isMovePayload(value)).toBe(false);
    });
  });

  describe('isFireRequestPayload / isFirePayload', () => {
    const FIRE_REQUEST = {
      playerId: 'P2',
      weaponId: 'normal',
      startX: 4550,
      startY: 912,
      velocityX: -600,
      velocityY: -600,
      seed: 42,
    };
    const FIRE = { ...FIRE_REQUEST, turnId: 1 };

    it('① FIRE_REQUEST 合法通过；七字段逐一腐蚀拒绝', () => {
      expect(isFireRequestPayload(FIRE_REQUEST)).toBe(true);
      expect(isFireRequestPayload(corrupt(FIRE_REQUEST, (r) => { r.velocityX = Number.NaN; }))).toBe(false);
      expect(isFireRequestPayload(corrupt(FIRE_REQUEST, (r) => { r.velocityY = Number.NEGATIVE_INFINITY; }))).toBe(false);
      expect(isFireRequestPayload(corrupt(FIRE_REQUEST, (r) => { r.seed = 1.5; }))).toBe(false);
      expect(isFireRequestPayload(corrupt(FIRE_REQUEST, (r) => { r.weaponId = 'nuke'; }))).toBe(false);
      expect(isFireRequestPayload(corrupt(FIRE_REQUEST, (r) => { r.playerId = null; }))).toBe(false);
      expect(isFireRequestPayload(corrupt(FIRE_REQUEST, (r) => { delete r.startX; }))).toBe(false);
      expect(isFireRequestPayload(corrupt(FIRE_REQUEST, (r) => { r.startY = {}; }))).toBe(false);
    });

    it('② FIRE 合法通过（canonical FireCommand 去 type）；turnId 腐蚀拒绝', () => {
      expect(isFirePayload(FIRE)).toBe(true);
      expect(isFirePayload(corrupt(FIRE, (r) => { r.turnId = 2.5; }))).toBe(false);
      expect(isFirePayload(corrupt(FIRE, (r) => { r.turnId = Number.NaN; }))).toBe(false);
    });

    it.each(NON_OBJECTS)('③ 非对象拒绝（%s）', (_label, value) => {
      expect(isFireRequestPayload(value)).toBe(false);
      expect(isFirePayload(value)).toBe(false);
    });
  });

  describe('isTurnResultPayload（深校验）', () => {
    it('① 合法样本通过；多余字段不拒绝', () => {
      expect(isTurnResultPayload(TURN_RESULT)).toBe(true);
      expect(isTurnResultPayload({ ...TURN_RESULT, extra: true })).toBe(true);
    });

    it.each(NON_OBJECTS)('② 非对象拒绝（%s）', (_label, value) => {
      expect(isTurnResultPayload(value)).toBe(false);
    });

    it('③ 顶层字段腐蚀', () => {
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.turnId = 1.5; }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.stateHash = ''; }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.gameOver = 1; }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.winnerId = 'P3'; }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.nextTurnId = Number.POSITIVE_INFINITY; }))).toBe(false);
    });

    it('④ impact 腐蚀：非 null 非 {x,y} → 拒绝', () => {
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.impact = { x: 1 }; }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.impact = { x: Number.NaN, y: 2 }; }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.impact = 'missed'; }))).toBe(false);
      // impact = null（出界）合法
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => { r.impact = null; }))).toBe(true);
    });

    it('⑤ 深层腐蚀：players 缺 P1 / hpBefore 缺失 / damages 腐蚀 → 拒绝', () => {
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => {
        delete record(r.players).P1;
      }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => {
        delete record(record(r.players).P2).hpBefore;
      }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => {
        record(r.damages).P1 = 1.5;
      }))).toBe(false);
      expect(isTurnResultPayload(corrupt(TURN_RESULT, (r) => {
        delete record(r.damages).P2;
      }))).toBe(false);
    });
  });

  describe('isTurnEndPayload / isCommandRejectedPayload / isDisconnectPayload', () => {
    it('① TURN_END 合法通过；字段腐蚀拒绝', () => {
      expect(isTurnEndPayload({ nextPlayerId: 'P2', nextTurnId: 2 })).toBe(true);
      expect(isTurnEndPayload(corrupt({ nextPlayerId: 'P2', nextTurnId: 2 }, (r) => { r.nextPlayerId = 'P3'; }))).toBe(false);
      expect(isTurnEndPayload(corrupt({ nextPlayerId: 'P2', nextTurnId: 2 }, (r) => { r.nextTurnId = 2.5; }))).toBe(false);
    });

    it('② COMMAND_REJECTED 合法通过；commandType / reason 腐蚀拒绝', () => {
      expect(isCommandRejectedPayload({ commandType: 'FIRE', reason: 'ALREADY_FIRED' })).toBe(true);
      expect(isCommandRejectedPayload({ commandType: 'MOVE', reason: 'STALE_TURN' })).toBe(true);
      expect(isCommandRejectedPayload(corrupt({ commandType: 'MOVE', reason: 'STALE_TURN' }, (r) => { r.commandType = 'READY'; }))).toBe(false);
      expect(isCommandRejectedPayload(corrupt({ commandType: 'MOVE', reason: 'STALE_TURN' }, (r) => { r.reason = 'UNKNOWN_REASON'; }))).toBe(false);
    });

    it('③ reason="toString"（原型链键）必须拒绝 —— hasOwnProperty 防线', () => {
      expect(isCommandRejectedPayload({ commandType: 'FIRE', reason: 'toString' })).toBe(false);
      expect(isCommandRejectedPayload({ commandType: 'FIRE', reason: 'constructor' })).toBe(false);
    });

    it('④ DISCONNECT：reason 任意 string（含空串）通过；非 string 拒绝', () => {
      expect(isDisconnectPayload({ reason: 'USER_EXIT' })).toBe(true);
      expect(isDisconnectPayload({ reason: '' })).toBe(true);
      expect(isDisconnectPayload(corrupt({ reason: 'x' }, (r) => { r.reason = 42; }))).toBe(false);
    });

    it.each(NON_OBJECTS)('⑤ 非对象拒绝（%s）', (_label, value) => {
      expect(isTurnEndPayload(value)).toBe(false);
      expect(isCommandRejectedPayload(value)).toBe(false);
      expect(isDisconnectPayload(value)).toBe(false);
    });
  });

  describe('isAuthoritativeGameSnapshot', () => {
    it('① 合法样本通过；多余字段不拒绝', () => {
      expect(isAuthoritativeGameSnapshot(GAME_SNAPSHOT)).toBe(true);
      expect(isAuthoritativeGameSnapshot({ ...GAME_SNAPSHOT, extra: 1 })).toBe(true);
    });

    it('② 字段腐蚀：items 非数组 / winnerId 非法 → 拒绝', () => {
      expect(isAuthoritativeGameSnapshot(corrupt(GAME_SNAPSHOT, (r) => { r.items = {}; }))).toBe(false);
      expect(isAuthoritativeGameSnapshot(corrupt(GAME_SNAPSHOT, (r) => { r.winnerId = 'P3'; }))).toBe(false);
      expect(isAuthoritativeGameSnapshot(corrupt(GAME_SNAPSHOT, (r) => { r.matchId = ''; }))).toBe(false);
    });

    it.each(NON_OBJECTS)('③ 非对象拒绝（%s）', (_label, value) => {
      expect(isAuthoritativeGameSnapshot(value)).toBe(false);
    });
  });
});
