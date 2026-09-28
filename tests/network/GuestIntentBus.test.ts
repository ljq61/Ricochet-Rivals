import { describe, expect, it, vi } from 'vitest';
import { GuestIntentBus } from '../../src/game/network/online/GuestIntentBus';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';
import type { GameState } from '../../src/game/state/GameState';
import type {
  FireRequestPayload,
  MoveRequestPayload,
} from '../../src/game/network/online/OnlineTypes';
import {
  isFireRequestPayload,
  isMoveRequestPayload,
} from '../../src/game/network/online/OnlinePayloads';
import type { FireCommand, MoveCommand } from '../../src/game/commands/GameCommand';

/**
 * Guest 意图总线（Phase 14）：本地命令 → *_REQUEST 上报 Host，不本地执行。
 * Guest 固定 P2（Host = P1）；remote P1 的权威命令必须被防御性丢弃。
 */

function makeState(phase: TurnPhase): GameState {
  const state = createInitialGameState({ matchId: 'm', seed: 7 });
  state.phase = phase;
  return state;
}

function makeBus(phase: TurnPhase) {
  const sendMoveRequest = vi.fn<(payload: MoveRequestPayload) => void>();
  const sendFireRequest = vi.fn<(payload: FireRequestPayload) => void>();
  const state = makeState(phase);
  const bus = new GuestIntentBus({
    localPlayerId: 'P2',
    getState: () => state,
    sendMoveRequest,
    sendFireRequest,
  });
  return { bus, state, sendMoveRequest, sendFireRequest };
}

const MOVE: MoveCommand = { type: 'MOVE', playerId: 'P2', turnId: 1, targetX: 500 };
const FIRE: FireCommand = {
  type: 'FIRE',
  playerId: 'P2',
  turnId: 1,
  weaponId: 'normal',
  startX: 4550,
  startY: 912,
  velocityX: -600,
  velocityY: -600,
  seed: 7,
};

describe('GuestIntentBus（Phase 14）', () => {
  it('① MOVE：ACTION 相位转发且 payload 精确为 {playerId, targetX}（无 turnId）', () => {
    const { bus, sendMoveRequest } = makeBus(TurnPhase.ACTION);
    bus.dispatch(MOVE);
    expect(sendMoveRequest).toHaveBeenCalledTimes(1);
    expect(sendMoveRequest).toHaveBeenCalledWith({ playerId: 'P2', targetX: 500 });
    const payload = sendMoveRequest.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(isMoveRequestPayload(payload)).toBe(true);
  });

  it.each([
    ['START', TurnPhase.START],
    ['RETURN_HOME', TurnPhase.RETURN_HOME],
    ['AIM', TurnPhase.AIM],
    ['PROJECTILE', TurnPhase.PROJECTILE],
    ['RESOLVE', TurnPhase.RESOLVE],
    ['END', TurnPhase.END],
  ] as const)('② MOVE：非 ACTION 相位（%s）丢弃', (_label, phase) => {
    const { bus, sendMoveRequest } = makeBus(phase);
    bus.dispatch(MOVE);
    expect(sendMoveRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTION', TurnPhase.ACTION],
    ['RETURN_HOME', TurnPhase.RETURN_HOME],
    ['AIM', TurnPhase.AIM],
  ] as const)('③ FIRE：%s 相位转发，payload 精确 7 字段', (_label, phase) => {
    const { bus, sendFireRequest } = makeBus(phase);
    bus.dispatch(FIRE);
    expect(sendFireRequest).toHaveBeenCalledTimes(1);
    expect(sendFireRequest).toHaveBeenCalledWith({
      playerId: 'P2',
      weaponId: 'normal',
      startX: 4550,
      startY: 912,
      velocityX: -600,
      velocityY: -600,
      seed: 7,
    });
    const payload = sendFireRequest.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(isFireRequestPayload(payload)).toBe(true);
  });

  it('④ FIRE：PROJECTILE 相位丢弃（表现层降噪；权威在 Host）', () => {
    const { bus, sendFireRequest } = makeBus(TurnPhase.PROJECTILE);
    bus.dispatch(FIRE);
    expect(sendFireRequest).not.toHaveBeenCalled();
  });

  it('⑤ remote playerId（P1 权威命令）：warn + 零转发', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus, sendMoveRequest, sendFireRequest } = makeBus(TurnPhase.ACTION);
    bus.dispatch({ ...MOVE, playerId: 'P1' });
    bus.dispatch({ ...FIRE, playerId: 'P1' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(sendMoveRequest).not.toHaveBeenCalled();
    expect(sendFireRequest).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('⑥ READY：离线语义，零转发', () => {
    const { bus, sendMoveRequest, sendFireRequest } = makeBus(TurnPhase.ACTION);
    bus.dispatch({ type: 'READY', playerId: 'P2' });
    expect(sendMoveRequest).not.toHaveBeenCalled();
    expect(sendFireRequest).not.toHaveBeenCalled();
  });

  it('⑦ NaN / Infinity 参数：MOVE 与 FIRE 均零转发', () => {
    const { bus, sendMoveRequest, sendFireRequest } = makeBus(TurnPhase.ACTION);
    bus.dispatch({ ...MOVE, targetX: Number.NaN });
    bus.dispatch({ ...MOVE, targetX: Number.POSITIVE_INFINITY });
    bus.dispatch({ ...FIRE, velocityX: Number.NaN });
    bus.dispatch({ ...FIRE, velocityY: Number.POSITIVE_INFINITY });
    bus.dispatch({ ...FIRE, seed: Number.NaN });
    bus.dispatch({ ...FIRE, startX: Number.NEGATIVE_INFINITY });
    expect(sendMoveRequest).not.toHaveBeenCalled();
    expect(sendFireRequest).not.toHaveBeenCalled();
  });

  it('⑧ subscribe：handler 永不被调用，取消函数为 no-op', () => {
    const { bus } = makeBus(TurnPhase.ACTION);
    const handler = vi.fn<(command: unknown) => void>();
    const cancel = bus.subscribe(handler);
    bus.dispatch(MOVE);
    expect(handler).not.toHaveBeenCalled();
    expect(() => cancel()).not.toThrow();
  });

  it('⑨ 意图只进 send 回调：总线上无本地执行副作用（state 不因 dispatch 改变）', () => {
    const { bus, state, sendMoveRequest } = makeBus(TurnPhase.ACTION);
    const xBefore = state.players.P2.x;
    bus.dispatch(MOVE);
    expect(sendMoveRequest).toHaveBeenCalled();
    expect(state.players.P2.x).toBe(xBefore);
    expect(state.players.P2.hasFired).toBe(false);
  });
});
