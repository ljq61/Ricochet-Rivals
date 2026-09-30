import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  advanceToP2Turn,
  createOnlineHarness,
  type OnlineHarness,
} from './onlineHarness';
import { OnlineGameCoordinator } from '../../src/game/network/online/OnlineGameCoordinator';
import { isGameStartPayload } from '../../src/game/network/online/OnlinePayloads';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { validateEnvelope } from '../../src/game/network/NetworkProtocol';
import { createLoopbackPair } from '../../src/game/network/LocalLoopbackTransport';
import { NetworkManager } from '../../src/game/network/NetworkManager';
import type { OnlineSession } from '../../src/game/network/OnlineSession';
import type { FireCommand, MoveCommand } from '../../src/game/commands/GameCommand';
import { TurnPhase } from '../../src/game/state/TurnPhase';

/**
 * OnlineGameCoordinator 单测（Phase 14，双端 LocalLoopbackTransport 真连接）：
 * Host 权威 / Guest 意图 / 幂等 / stale turn / Turn Barrier / 断线。
 * 真实 GameLogic（Movement / Fire 真系统，Projectile launch spy）——
 * 单一 validate+execute 路径全程生效。
 */

let h: OnlineHarness;

beforeEach(async () => {
  h = await createOnlineHarness();
});

describe('Lobby 握手（PLAYER_READY → GAME_START）', () => {
  it('① Host 汇齐双方 PLAYER_READY → onStart 恰一次，payload 过守卫且携带 identity', () => {
    expect(h.hostBootCount).toBe(1);
    expect(h.guestBootCount).toBe(1);
    expect(isGameStartPayload(h.hostBoot.gameStart)).toBe(true);
    expect(h.hostBoot.gameStart.matchId).toBe('m');
    expect(h.hostBoot.gameStart.seed).toBe(7);
    expect(h.hostBoot.gameStart.hostPlayerId).toBe('P1');
    expect(h.hostBoot.gameStart.guestPlayerId).toBe('P2');
    expect(h.hostBoot.coordinator).toBe(h.hostCoord);
  });

  it('② 双端 GAME_START 同源（深相等）', () => {
    expect(h.guestBoot.gameStart).toEqual(h.hostBoot.gameStart);
    expect(h.guestBoot.role).toBe('guest');
  });
});

describe('attach 前置守卫', () => {
  it('③ attach 前访问 inputBus / damageSystem throw；未握手 attach throw；重复 attach throw', async () => {
    const fresh = await createOnlineHarness({ attach: false });
    expect(() => fresh.hostCoord.inputBus).toThrow();
    expect(() => fresh.hostCoord.damageSystem).toThrow();

    // 未 enterLobby（无 GAME_START）的协调器：attach 必须拒绝
    const { a, b } = createLoopbackPair();
    const nmA = new NetworkManager({ transport: a, matchId: 'm', localPlayerId: 'P1' });
    void b;
    void nmA;
    const session: OnlineSession = {
      role: 'host',
      localPlayerId: 'P1',
      remotePlayerId: 'P2',
      transport: a,
      networkManager: nmA,
    };
    const bare = new OnlineGameCoordinator({
      session,
      createMatchIdentity: () => ({ matchId: 'm', seed: 7 }),
    });
    expect(() =>
      bare.attach({
        getState: () => fresh.hostState,
        commandBus: fresh.hostBus,
        gameLogic: fresh.hostLogic,
        turnManager: fresh.hostTurn,
        resumeNextTurn: () => {},
        showAuthoritativeDamage: () => {},
        showRejected: () => {},
        onDisconnected: () => {},
      }),
    ).toThrow(/GAME_START/);

    // 已 attach 的主 harness：重复 attach 拒绝
    expect(() =>
      h.hostCoord.attach({
        getState: () => h.hostState,
        commandBus: h.hostBus,
        gameLogic: h.hostLogic,
        turnManager: h.hostTurn,
        resumeNextTurn: vi.fn(),
        showAuthoritativeDamage: vi.fn(),
        showRejected: vi.fn(),
        onDisconnected: vi.fn(),
      }),
    ).toThrow(/twice/);
    fresh.dispose();
  });
});

describe('MOVE 同步（Host 权威 + Guest 意图）', () => {
  it('④ Host 本地 MOVE：经 outcome 广播，Guest 应用权威位置与有限兼容字段', async () => {
    h.hostCoord.inputBus.dispatch({ type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 600 });
    await h.flush();

    expect(h.hostState.players.P1.x).toBe(600);
    expect(h.hostState.players.P1.moveRemaining).toBe(0);
    expect(h.guestState.players.P1.x).toBe(600);
    expect(h.guestState.players.P1.moveRemaining).toBe(0);
  });

  it('⑤ Guest MOVE：MOVE_REQUEST → Host 系统执行 → 广播 → 双端一致', async () => {
    advanceToP2Turn(h);
    h.guestCoord.inputBus.dispatch({ type: 'MOVE', playerId: 'P2', turnId: 1, targetX: 4570 });
    await h.flush();

    expect(h.hostState.players.P2.x).toBe(4570);
    expect(h.hostState.players.P2.moveRemaining).toBe(0);
    expect(h.guestState.players.P2.x).toBe(4570);
    expect(h.guestState.players.P2.moveRemaining).toBe(0);
  });

  it('⑥ 越界 targetX：Host 限速与基地边界 clamp → 广播最终权威值', async () => {
    advanceToP2Turn(h);
    h.hostState.players.P2.x = h.guestState.players.P2.x = 4880;
    h.guestCoord.inputBus.dispatch({ type: 'MOVE', playerId: 'P2', turnId: 1, targetX: 6000 });
    await h.flush();

    // 单次突发限速32px，再 clamp 到基地上界4900。
    expect(h.hostState.players.P2.x).toBe(4900);
    expect(h.guestState.players.P2.x).toBe(4900);
    expect(h.guestState.players.P2.moveRemaining).toBe(0);
  });

  it('⑦ moveRemaining=0 是兼容字段，Guest 仍可在基地内移动', async () => {
    advanceToP2Turn(h);
    h.hostState.players.P2.moveRemaining = 0;
    h.guestState.players.P2.moveRemaining = 0;
    h.guestCoord.inputBus.dispatch({ type: 'MOVE', playerId: 'P2', turnId: 1, targetX: 4570 });
    await h.flush();

    expect(h.guestRejected).not.toHaveBeenCalled();
    expect(h.hostState.players.P2.x).toBe(4570);
    expect(h.guestState.players.P2.x).toBe(4570);
    expect(h.hostState.players.P2.moveRemaining).toBe(0);
    expect(h.guestState.players.P2.moveRemaining).toBe(0);
  });

  it('⑧ 伪造 playerId（payload 与 sender 不符）→ INVALID_PLAYER，Host 零执行', async () => {
    h.guestNm.setTurnId(1);
    h.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P1', targetX: 600 });
    await h.flush();

    expect(h.guestRejected).toHaveBeenCalledTimes(1);
    expect(h.guestRejected.mock.calls[0]?.[0]).toEqual({
      commandType: 'MOVE',
      reason: 'INVALID_PLAYER',
    });
    expect(h.hostState.players.P1.x).toBe(450);
  });

  it('⑨ stale turn 拒绝 / future turn 丢弃（无回执）', async () => {
    advanceToP2Turn(h);
    h.guestNm.setTurnId(0); // state.turnId = 1
    h.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P2', targetX: 4700 });
    await h.flush();
    expect(h.guestRejected.mock.calls[0]?.[0]).toEqual({
      commandType: 'MOVE',
      reason: 'STALE_TURN',
    });
    expect(h.hostState.players.P2.x).toBe(4550);

    const rejectedBefore = h.guestRejected.mock.calls.length;
    h.guestNm.setTurnId(5); // 未来回合：静默丢弃
    h.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P2', targetX: 4700 });
    await h.flush();
    expect(h.guestRejected.mock.calls.length).toBe(rejectedBefore);
    expect(h.hostState.players.P2.x).toBe(4550);
  });

  it('⑩ 重复 sequence 重放：Host 只执行一次（无二次位移）', async () => {
    advanceToP2Turn(h);
    const envelope = validateEnvelope({
      version: 1,
      type: NetworkMessageType.MOVE_REQUEST,
      matchId: 'm',
      turnId: 1,
      senderId: 'P2',
      sequence: 42,
      timestamp: Date.now(),
      payload: { playerId: 'P2', deltaX: 20 },
    });
    h.guestTransport.send(envelope);
    await h.flush();
    expect(h.hostState.players.P2.x).toBe(4570);
    expect(h.hostState.players.P2.moveRemaining).toBe(0);

    h.guestTransport.send(envelope); // 同 sequence 重放
    await h.flush();
    expect(h.hostState.players.P2.x).toBe(4570);
    expect(h.hostState.players.P2.moveRemaining).toBe(0);
  });
});

describe('FIRE 同步', () => {
  it('⑪ Host 本地 FIRE：双端各恰一次 launch', async () => {
    const fire: FireCommand = {
      type: 'FIRE',
      playerId: 'P1',
      turnId: 1,
      weaponId: 'normal',
      startX: 450,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: 600,
      velocityY: -600,
      seed: 7,
    };
    h.hostCoord.inputBus.dispatch(fire);
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    await h.flush();
    expect(h.guestLaunch).toHaveBeenCalledTimes(1);
    expect(h.guestState.players.P1.hasFired).toBe(true);
  });

  it('⑫ Guest FIRE：请求 → Host 校验 → 广播 → 双端 launch + hasFired', async () => {
    advanceToP2Turn(h);
    const fire: FireCommand = {
      type: 'FIRE',
      playerId: 'P2',
      turnId: 1,
      weaponId: 'normal',
      startX: 4550,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: -600,
      velocityY: -600,
      seed: 7,
    };
    h.guestCoord.inputBus.dispatch(fire);
    await h.flush();

    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    expect(h.guestLaunch).toHaveBeenCalledTimes(1);
    expect(h.hostState.players.P2.hasFired).toBe(true);
    expect(h.guestState.players.P2.hasFired).toBe(true);
  });

  it('⑬ 二次 FIRE：ALREADY_FIRED 回执，launch 总数不变', async () => {
    advanceToP2Turn(h);
    const fire: FireCommand = {
      type: 'FIRE',
      playerId: 'P2',
      turnId: 1,
      weaponId: 'normal',
      startX: 4550,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: -600,
      velocityY: -600,
      seed: 7,
    };
    h.guestCoord.inputBus.dispatch(fire);
    await h.flush();
    h.guestCoord.inputBus.dispatch(fire);
    await h.flush();

    expect(h.guestRejected).toHaveBeenCalledTimes(1);
    expect(h.guestRejected.mock.calls[0]?.[0]).toEqual({
      commandType: 'FIRE',
      reason: 'ALREADY_FIRED',
    });
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    expect(h.guestLaunch).toHaveBeenCalledTimes(1);
  });

  it('⑭ 速度超上限（speed 2828 > 2400）→ INVALID_FIRE，Host 未标记已发射', async () => {
    advanceToP2Turn(h);
    h.guestNm.setTurnId(1);
    h.guestNm.send(NetworkMessageType.FIRE_REQUEST, {
      playerId: 'P2',
      weaponId: 'normal',
      startX: 4550,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: -2000,
      velocityY: -2000,
      seed: 7,
    });
    await h.flush();

    expect(h.guestRejected.mock.calls[0]?.[0]).toEqual({
      commandType: 'FIRE',
      reason: 'INVALID_FIRE',
    });
    expect(h.hostState.players.P2.hasFired).toBe(false);
    expect(h.hostLaunch).not.toHaveBeenCalled();
  });

  it('⑮ 起点偏离权威炮塔（50px）→ INVALID_FIRE', async () => {
    advanceToP2Turn(h);
    h.guestNm.setTurnId(1);
    h.guestNm.send(NetworkMessageType.FIRE_REQUEST, {
      playerId: 'P2',
      weaponId: 'normal',
      startX: 4600,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: -600,
      velocityY: -600,
      seed: 7,
    });
    await h.flush();
    expect(h.guestRejected.mock.calls[0]?.[0]).toEqual({
      commandType: 'FIRE',
      reason: 'INVALID_FIRE',
    });
  });

  it('⑯ seed 与权威状态不符 → INVALID_FIRE', async () => {
    advanceToP2Turn(h);
    h.guestNm.setTurnId(1);
    h.guestNm.send(NetworkMessageType.FIRE_REQUEST, {
      playerId: 'P2',
      weaponId: 'normal',
      startX: 4550,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: -600,
      velocityY: -600,
      seed: 8,
    });
    await h.flush();
    expect(h.guestRejected.mock.calls[0]?.[0]).toEqual({
      commandType: 'FIRE',
      reason: 'INVALID_FIRE',
    });
  });
});

describe('TURN_RESULT 权威覆写', () => {
  it('⑰ Host 结果覆写 Guest 预测 + 权威伤害数字展示 + hashMatch', async () => {
    const fire: FireCommand = {
      type: 'FIRE',
      playerId: 'P1',
      turnId: 1,
      weaponId: 'normal',
      startX: 450,
      startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
      velocityX: 600,
      velocityY: -600,
      seed: 7,
    };
    h.hostCoord.inputBus.dispatch(fire);
    await h.flush();
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();

    // ① 先 Guest 本地结算：预测 impact 偏到 4700（0 伤害）+ 伪造预测残留 hp=9
    const explosion = {
      sourcePlayerId: 'P1' as const,
      weaponId: 'normal' as const,
      x: 4550,
      y: 920,
      radius: 140,
      turnId: 1,
    };
    const localResult = h.guestCoord.damageSystem.calculate(h.guestState, {
      ...explosion,
      x: 4700, // 本地预测偏差：>140 无伤害
    });
    h.guestTurn.notifyProjectileResolved(localResult);
    h.guestState.players.P2.hp = 9; // 伪造本地预测污染
    h.guestCoord.notifyTurnResolved(
      { x: 4700, y: 920, ownerId: 'P1', weaponId: 'normal', turnId: 1 },
      localResult,
    );
    expect(h.guestShowDamage).not.toHaveBeenCalled(); // 双条件未齐：无展示

    // ② Host 结算：直伤命中 P2（10 → 8）→ TURN_RESULT
    const result = h.hostCoord.damageSystem.calculate(h.hostState, explosion);
    h.hostCoord.damageSystem.apply(h.hostState, result);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(
      { x: 4550, y: 920, ownerId: 'P1', weaponId: 'normal', turnId: 1 },
      result,
    );
    await h.flush();

    // 权威覆写：HP 以 Host 为准 + 展示 Host 的伤害数值（不是本地预测）
    expect(h.guestState.players.P2.hp).toBe(8);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    const shown = h.guestShowDamage.mock.calls[0]?.[0];
    const shownP2 = shown?.players.find((p) => p.playerId === 'P2');
    expect(shownP2?.damage).toBe(2);
    expect(shownP2?.hpBefore).toBe(10);
    expect(shownP2?.hpAfter).toBe(8);
    expect(h.hostShowDamage).not.toHaveBeenCalled(); // Host 走场景本地直显
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
  });
});

describe('Turn Barrier（Host 控制回合切换）', () => {
  /**
   * 把双端推到 RESOLVE 并走真实 TURN_RESULT 收口（Phase 15 ACK Barrier 契约：
   * TURN_END 前必须有 TURN_RESULT + Guest ACK；resolveOnly 仅推 phase 不发
   * TURN_RESULT —— MISSING_TURN_RESULT 用例专用）。
   */
  function resolveBothSides(): void {
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null);
    h.guestTurn.notifyProjectileResolved(null);
  }

  /** resolveBothSides + Host 发 TURN_RESULT + flush（Guest 应用并 ACK 回 Host） */
  async function resolveAndAck(): Promise<void> {
    resolveBothSides();
    h.hostCoord.notifyTurnResolved(null, null);
    await h.flush();
  }

  it('⑱-A Guest dwell 先完成 → waiting；TURN_END 到达后推进 + resume 恰一次', async () => {
    await resolveAndAck();
    expect(h.guestCoord.onLocalAttackResolved()).toBe('waiting');
    expect(h.guestState.currentPlayerId).toBe('P1'); // 未推进
    expect(h.guestResume).not.toHaveBeenCalled();

    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed'); // ACK 已到 → 发 TURN_END
    await h.flush();
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestState.turnId).toBe(2);
    expect(h.guestState.players.P2.moveRemaining).toBe(0);
    expect(h.guestResume).toHaveBeenCalledTimes(1);
  });

  it('⑱-B Host 先发 TURN_END（Guest 未 dwell）→ 缓存不推进；Guest dwell 后推进', async () => {
    await resolveAndAck();
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    await h.flush();
    // TURN_END 已到但本地 dwell 未完成：不推进
    expect(h.guestState.currentPlayerId).toBe('P1');
    expect(h.guestResume).not.toHaveBeenCalled();

    expect(h.guestCoord.onLocalAttackResolved()).toBe('proceed');
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestState.turnId).toBe(2);
    expect(h.guestResume).toHaveBeenCalledTimes(1);
  });

  it('⑲ TURN_END nextPlayerId 异常（与当前相同）→ warn 后仍按 Host 值应用', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await resolveAndAck();
      h.guestCoord.onLocalAttackResolved(); // dwellComplete = true
      h.hostNm.setTurnId(1);
      h.hostNm.send(NetworkMessageType.TURN_END, { nextPlayerId: 'P1', nextTurnId: 2 });
      await h.flush();

      expect(warn).toHaveBeenCalled();
      expect(h.guestState.currentPlayerId).toBe('P1'); // Host 权威值
      expect(h.guestState.turnId).toBe(2);
      expect(h.guestResume).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('断线与生命周期', () => {
  it('⑲-1 Battle 期通道中断 → 双方 onDisconnected；gameOver 后中断被抑制', async () => {
    // 正常中断：Guest 收到通知
    h.hostTransport.close();
    expect(h.guestDisconnected).toHaveBeenCalledTimes(1);

    // gameOver 后的关闭（对局结束正常收尾）不触发提示
    const h2 = await createOnlineHarness();
    h2.guestState.gameOver = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      h2.hostTransport.close();
      expect(h2.guestDisconnected).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      h2.dispose();
    }
  });

  it('⑲-2 Lobby 期通道中断 → lobby onDisconnected 转发', async () => {
    const lobbyOnly = await createOnlineHarness({ attach: false });
    lobbyOnly.hostTransport.close();
    expect(lobbyOnly.guestDisconnected).toHaveBeenCalledTimes(1);
    lobbyOnly.dispose();
  });

  it('⑳ dispose：DISCONNECT 尽力而为送达对端 + 幂等 + 之后入站全静默', async () => {
    const disconnectSpy = vi.fn<(payload: unknown) => void>();
    h.guestNm.onMessage(NetworkMessageType.DISCONNECT, (envelope) =>
      disconnectSpy(envelope.payload),
    );
    h.hostCoord.dispose();
    await h.flush();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy.mock.calls[0]?.[0]).toEqual({ reason: 'USER_EXIT' });
    expect(() => h.hostCoord.dispose()).not.toThrow(); // 幂等

    // dispose 后入站静默：Guest 再发请求无副作用、无异常
    h.guestNm.setTurnId(1);
    h.guestNm.send(NetworkMessageType.MOVE_REQUEST, { playerId: 'P2', targetX: 4700 });
    await h.flush();
    expect(h.hostState.players.P2.x).toBe(4550);
  });

  it('㉑ damageSystem：Host 真 apply；Guest calculate-only（HP 只经 TURN_RESULT 改写）', () => {
    const explosion = {
      sourcePlayerId: 'P1' as const,
      weaponId: 'normal' as const,
      x: 4550,
      y: 920,
      radius: 140,
      turnId: 1,
    };
    const hostResult = h.hostCoord.damageSystem.calculate(h.hostState, explosion);
    expect(hostResult.players.find((p) => p.playerId === 'P2')?.damage).toBe(2);
    h.hostCoord.damageSystem.apply(h.hostState, hostResult);
    expect(h.hostState.players.P2.hp).toBe(8); // 权威 apply 生效

    const guestResult = h.guestCoord.damageSystem.calculate(h.guestState, explosion);
    expect(guestResult.players.find((p) => p.playerId === 'P2')?.damage).toBe(2);
    h.guestCoord.damageSystem.apply(h.guestState, guestResult);
    expect(h.guestState.players.P2.hp).toBe(10); // calculate-only：不落状态
  });
});

describe('isLocalTurn 与 debugInfo', () => {
  it('㉒ 视角与诊断快照', () => {
    expect(h.hostCoord.isLocalTurn()).toBe(true); // P1 回合
    expect(h.guestCoord.isLocalTurn()).toBe(false);
    const info = h.hostCoord.debugInfo();
    expect(info.role).toBe('host');
    expect(info.localPlayerId).toBe('P1');
    expect(info.matchId).toBe('m');
    expect(info.rejectedCount).toBe(0);
    expect(info.lastHashMatch).toBeNull(); // Host 不做 reconcile
  });
});

describe('系统层不感知网络（回归不变量）', () => {
  it('㉓ 离线语义零改写：READY 命令零副作用（GameLogic 忽略）', () => {
    const before = { x: h.hostState.players.P1.x, hp: h.hostState.players.P1.hp };
    h.hostBus.dispatch({ type: 'READY', playerId: 'P1' });
    expect(h.hostState.players.P1.x).toBe(before.x);
    expect(h.hostState.players.P1.hp).toBe(before.hp);
    expect(h.hostLaunch).not.toHaveBeenCalled();
    expect(h.hostState.phase).toBe(TurnPhase.ACTION);
  });

  it('㉔ MoveCommand 直接进 Host 真实总线仍走系统校验（单一路径证据）', () => {
    const cmd: MoveCommand = { type: 'MOVE', playerId: 'P2', turnId: 1, targetX: 4700 };
    h.hostBus.dispatch(cmd); // 绕过 coordinator 直接总线 —— 非当前玩家，系统拒绝
    expect(h.hostState.players.P2.x).toBe(4550);
  });
});

afterEach(() => {
  h.dispose();
  vi.restoreAllMocks();
});
