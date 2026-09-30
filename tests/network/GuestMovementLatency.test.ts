import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveInputCore } from '../../src/game/input/MoveInputCore';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { createInitialGameState } from '../../src/game/state/GameState';
import { MovementSystem } from '../../src/game/systems/MovementSystem';
import { TurnManager } from '../../src/game/systems/TurnManager';
import { getLaunchOrigin } from '../../src/game/physics/aimMath';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createOnlineHarness, advanceToP2Turn, type OnlineHarness } from './onlineHarness';

let h: OnlineHarness | undefined;
let clock = 0;
const dt = 1000 / 60;

afterEach(() => {
  h?.dispose();
  h = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start(latencyMs = 0): Promise<OnlineHarness> {
  clock = 0;
  h = await createOnlineHarness({ latencyMs, hostMovementNow: () => clock });
  advanceToP2Turn(h);
  h.guestNm.setTurnId(h.hostState.turnId);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return h;
}

async function tick(frames = 1): Promise<void> {
  for (let i = 0; i < frames; i++) {
    clock += dt;
    await vi.advanceTimersByTimeAsync(dt);
  }
}

function localBaseline(): { core: MoveInputCore; state: ReturnType<typeof createInitialGameState> } {
  const state = createInitialGameState({ matchId: 'm', seed: 7 });
  new TurnManager(state).beginTurn('P2');
  const movement = new MovementSystem();
  const core = new MoveInputCore(() => 'P2', () => state, {
    dispatch(command) {
      if (command.type === 'MOVE') movement.execute(state, command);
    },
    subscribe: () => () => {},
  });
  return { core, state };
}

describe('Guest 移动不依赖权威回包频率', () => {
  it.each([0, 50, 100])('RTT %i×2 ms：按住/松手与本地距离、预算一致', async (latencyMs) => {
    const net = await start(latencyMs);
    const core = new MoveInputCore(() => 'P2', () => net.guestState, net.guestCoord.inputBus);
    const local = localBaseline();
    core.setDirection(-1);
    local.core.setDirection(-1);
    for (let i = 0; i < 27; i++) {
      core.update(dt);
      local.core.update(dt);
      await tick();
    }
    core.setDirection(0);
    core.update(dt);
    await tick(20); // 释放前已经发送的有限帧增量完成有序投递。
    expect(net.hostState.players.P2.x).toBeCloseTo(local.state.players.P2.x, 6);
    expect(net.guestState.players.P2.x).toBeCloseTo(local.state.players.P2.x, 6);
    expect(net.hostState.players.P2.moveRemaining).toBeCloseTo(local.state.players.P2.moveRemaining, 6);
    const stoppedX = net.hostState.players.P2.x;
    await tick(60);
    expect(net.hostState.players.P2.x).toBe(stoppedX);
  });

  it('200 ms RTT：反转、边界与预算按实际路径消耗；耗尽不能续走', async () => {
    const net = await start(100);
    const core = new MoveInputCore(() => 'P2', () => net.guestState, net.guestCoord.inputBus);
    const local = localBaseline();
    for (const [direction, frames] of [[-1, 24], [1, 24], [-1, 60]] as const) {
      core.setDirection(direction);
      local.core.setDirection(direction);
      for (let i = 0; i < frames; i++) {
        core.update(dt);
        local.core.update(dt);
        await tick();
      }
    }
    await tick(20);
    expect(net.hostState.players.P2.x).toBeCloseTo(local.state.players.P2.x, 6);
    expect(net.hostState.players.P2.moveRemaining).toBe(0);
    expect(net.guestState.players.P2.moveRemaining).toBe(0);
    expect(net.hostState.players.P2.x).toBeGreaterThanOrEqual(GAME_CONFIG.player.rightBounds.minX);
    expect(net.hostState.players.P2.x).toBeLessThanOrEqual(GAME_CONFIG.player.rightBounds.maxX);
  });

  it('200 ms RTT：触碰平台边界后反向离开，不额外消耗预算', async () => {
    const net = await start(100);
    net.hostState.players.P2.x = net.guestState.players.P2.x = 4890;
    const core = new MoveInputCore(() => 'P2', () => net.guestState, net.guestCoord.inputBus);
    const local = localBaseline();
    local.state.players.P2.x = 4890;
    for (const direction of [1, -1] as const) {
      core.setDirection(direction);
      local.core.setDirection(direction);
      for (let i = 0; i < 24; i++) {
        core.update(dt);
        local.core.update(dt);
        await tick();
      }
    }
    await tick(20);
    expect(net.hostState.players.P2.x).toBeCloseTo(local.state.players.P2.x, 6);
    expect(net.hostState.players.P2.moveRemaining).toBeCloseTo(local.state.players.P2.moveRemaining, 6);
    expect(net.hostState.players.P2.x).toBeLessThan(4900);
  });
});

describe('Host 移动速度与发射起点仍由权威校验', () => {
  it('恶意大增量/旧 absolute 请求洪水不能在相同Host时刻耗尽250px预算', async () => {
    const net = await start();
    const startX = net.hostState.players.P2.x;
    for (let i = 0; i < 20; i++) {
      net.guestNm.send(NetworkMessageType.MOVE_REQUEST,
        i % 2 ? { playerId: 'P2', targetX: 1e9 } : { playerId: 'P2', deltaX: 1e9 });
    }
    await vi.advanceTimersByTimeAsync(1);
    expect(net.hostState.players.P2.x - startX).toBeCloseTo(32, 6);
    expect(net.hostState.players.P2.moveRemaining).toBeCloseTo(218, 6);
  });

  it.each([0, 50, 100])('RTT %i×2 ms：移动后立即开火校正到当前权威炮塔', async (latencyMs) => {
    const net = await start(latencyMs);
    const core = new MoveInputCore(() => 'P2', () => net.guestState, net.guestCoord.inputBus);
    core.setDirection(-1);
    for (let i = 0; i < 24; i++) {
      core.update(dt);
      await tick();
    }
    const staleOrigin = getLaunchOrigin(net.guestState.players.P2);
    net.guestCoord.inputBus.dispatch({
      type: 'FIRE', playerId: 'P2', turnId: 1, weaponId: 'normal',
      startX: staleOrigin.x, startY: staleOrigin.y,
      velocityX: -1500, velocityY: -1500, seed: 7,
    });
    await tick(20);
    expect(net.hostLaunch).toHaveBeenCalledTimes(1);
    expect(net.guestLaunch).toHaveBeenCalledTimes(1);
    const authoritative = getLaunchOrigin(net.hostState.players.P2);
    expect(net.hostLaunch.mock.calls[0]?.[0].startX).toBe(authoritative.x);
    expect(net.guestLaunch.mock.calls[0]?.[0].startX).toBe(authoritative.x);
    expect(net.hostLaunch.mock.calls[0]?.[0].startY).toBe(authoritative.y);
    expect(net.guestRejected).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'INVALID_FIRE' }));
  });

  it.each(['unknown', 'expired', 'wrongY'] as const)('%s 发射起点不允许历史校正', async (kind) => {
    const net = await start();
    const oldOrigin = getLaunchOrigin(net.hostState.players.P2);
    net.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P2', deltaX: -20 });
    await tick();
    expect(net.hostState.players.P2.x).toBe(oldOrigin.x - 20);
    if (kind === 'expired') await tick(121);
    net.guestCoord.inputBus.dispatch({
      type: 'FIRE', playerId: 'P2', turnId: 1, weaponId: 'normal',
      startX: kind === 'unknown' ? oldOrigin.x + 100 : oldOrigin.x,
      startY: oldOrigin.y + (kind === 'wrongY' ? 100 : 0),
      velocityX: -1500, velocityY: -1500, seed: 7,
    });
    await tick(5);
    expect(net.hostLaunch).not.toHaveBeenCalled();
    expect(net.guestRejected).toHaveBeenCalledWith({ commandType: 'FIRE', reason: 'INVALID_FIRE' });
  });

  it.each(['snapshot', 'connectionRecovery', 'newTurn'] as const)('%s 清除旧移动起点校正历史', async (kind) => {
    const net = await start();
    const oldOrigin = getLaunchOrigin(net.hostState.players.P2);
    net.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P2', deltaX: -20 });
    await tick();
    if (kind === 'snapshot') {
      net.guestCoord.requestPostReconnectSync();
      await tick(5);
    } else if (kind === 'connectionRecovery') {
      net.hostCoord.setConnectionRecoveryActive(true);
      net.hostCoord.setConnectionRecoveryActive(false);
    } else {
      net.hostState.turnId += 1;
      net.guestState.turnId += 1;
    }
    net.guestCoord.inputBus.dispatch({
      type: 'FIRE', playerId: 'P2', turnId: net.guestState.turnId, weaponId: 'normal',
      startX: oldOrigin.x, startY: oldOrigin.y,
      velocityX: -1500, velocityY: -1500, seed: 7,
    });
    await tick(5);
    expect(net.hostLaunch).not.toHaveBeenCalled();
    expect(net.guestRejected).toHaveBeenCalledWith({ commandType: 'FIRE', reason: 'INVALID_FIRE' });
  });

  it('反转后仍能校正已接受的旧起点，广播当前权威起点', async () => {
    const net = await start();
    net.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P2', deltaX: -20 });
    await tick();
    const oldOrigin = getLaunchOrigin(net.hostState.players.P2);
    await tick(10);
    net.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P2', deltaX: 10 });
    await tick();
    net.guestCoord.inputBus.dispatch({
      type: 'FIRE', playerId: 'P2', turnId: 1, weaponId: 'normal',
      startX: oldOrigin.x, startY: oldOrigin.y,
      velocityX: -1500, velocityY: -1500, seed: 7,
    });
    await tick(5);
    expect(net.hostLaunch).toHaveBeenCalledTimes(1);
    expect(net.hostLaunch.mock.calls[0]?.[0].startX).toBe(oldOrigin.x + 10);
    expect(net.guestLaunch.mock.calls[0]?.[0].startX).toBe(oldOrigin.x + 10);
  });
});
