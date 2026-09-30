import { vi, type Mock } from 'vitest';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import type { CommandBus } from '../../src/game/commands/CommandBus';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import { createInitialGameState, type GameState } from '../../src/game/state/GameState';
import { GameLogic } from '../../src/game/systems/GameLogic';
import { MovementSystem } from '../../src/game/systems/MovementSystem';
import { FireSystem } from '../../src/game/systems/FireSystem';
import type { ProjectileSystem } from '../../src/game/systems/ProjectileSystem';
import { TurnManager } from '../../src/game/systems/TurnManager';
import { createLoopbackPair } from '../../src/game/network/LocalLoopbackTransport';
import { NetworkManager } from '../../src/game/network/NetworkManager';
import type { NetworkTransport } from '../../src/game/network/NetworkTransport';
import { OnlineGameCoordinator } from '../../src/game/network/online/OnlineGameCoordinator';
import { stateFromSnapshot } from '../../src/game/network/online/AuthoritativeState';
import type {
  CommandRejectedPayload,
  AuthoritativeGameSnapshot,
  OnlineBattleBootstrap,
} from '../../src/game/network/online/OnlineTypes';
import type { DamageResult } from '../../src/game/state/DamageResult';
import type { OnlineSession } from '../../src/game/network/OnlineSession';

/**
 * Phase 14 双端 Loopback 测试 harness：
 * LocalLoopbackTransport 真实连接两个 OnlineGameCoordinator（Host = P1 /
 * Guest = P2），真实 GameLogic（Movement / Fire 真系统，Projectile 用
 * launch spy 假体 —— node 环境无 Phaser）。OnlineGameCoordinator.test 与
 * OnlineLoopbackBattle.test 共用（沿 envelopeFixture.ts 先例）。
 */

export interface OnlineHarness {
  readonly hostCoord: OnlineGameCoordinator;
  readonly guestCoord: OnlineGameCoordinator;
  readonly hostNm: NetworkManager;
  readonly guestNm: NetworkManager;
  readonly hostTransport: NetworkTransport;
  readonly guestTransport: NetworkTransport;
  readonly hostState: GameState;
  readonly guestState: GameState;
  readonly hostBus: CommandBus;
  readonly guestBus: CommandBus;
  readonly hostLogic: GameLogic;
  readonly guestLogic: GameLogic;
  readonly hostLaunch: Mock<(command: FireCommand) => void>;
  readonly guestLaunch: Mock<(command: FireCommand) => void>;
  readonly hostTurn: TurnManager;
  readonly guestTurn: TurnManager;
  readonly hostResume: Mock<() => void>;
  readonly guestResume: Mock<() => void>;
  readonly hostShowDamage: Mock<(result: DamageResult) => void>;
  readonly guestShowDamage: Mock<(result: DamageResult) => void>;
  readonly hostRejected: Mock<(payload: CommandRejectedPayload) => void>;
  readonly guestRejected: Mock<(payload: CommandRejectedPayload) => void>;
  readonly hostDisconnected: Mock<(reason?: string) => void>;
  readonly guestDisconnected: Mock<(reason?: string) => void>;
  /** Phase 15：同步锁 / 同步状态 / 恢复失败 spies（Guest 侧锁，双端状态迁移） */
  readonly hostSyncStateChange: Mock<(state: unknown, detail?: string) => void>;
  readonly guestSyncStateChange: Mock<(state: unknown, detail?: string) => void>;
  readonly hostSyncFailure: Mock<() => void>;
  readonly guestSyncFailure: Mock<() => void>;
  readonly guestSetSyncLock: Mock<(locked: boolean) => void>;
  readonly guestSnapshotApplied: Mock<(snapshot: AuthoritativeGameSnapshot) => void>;
  readonly hostBoot: OnlineBattleBootstrap;
  readonly guestBoot: OnlineBattleBootstrap;
  /** onStart 各自触发次数（幂等回归断言用） */
  readonly hostBootCount: number;
  readonly guestBootCount: number;
  /** 结束测试：dispose 双协调器（清 PLAYER_READY 重发定时器）+ 关通道 */
  dispose(): void;
  /** 冲洗 loopback 异步投递（macrotask 链默认 4 轮，覆盖 2 跳往返） */
  flush(rounds?: number): Promise<void>;
}

export interface OnlineHarnessOptions {
  /** false：完成 Lobby 握手但不 attach（测 attach 前置守卫用） */
  readonly attach?: boolean;
  /** Phase 15：Host ACK 超时（缺省 8s；测试注入短值走重试阶梯） */
  readonly hostAckTimeoutMs?: number;
  readonly latencyMs?: number;
  readonly hostMovementNow?: () => number;
}

/** loopback 投递为 setTimeout(0) macrotask：每轮冲洗一跳链 */
export async function flushLoopback(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

export async function createOnlineHarness(
  options: OnlineHarnessOptions = {},
): Promise<OnlineHarness> {
  const attach = options.attach ?? true;

  // 1. 双端通道 + NetworkManager（同 pairing matchId）
  const { a, b } = createLoopbackPair({ latencyMs: options.latencyMs });
  const hostNm = new NetworkManager({ transport: a, matchId: 'm', localPlayerId: 'P1' });
  const guestNm = new NetworkManager({ transport: b, matchId: 'm', localPlayerId: 'P2' });

  const hostSession: OnlineSession = {
    role: 'host',
    localPlayerId: 'P1',
    remotePlayerId: 'P2',
    transport: a,
    networkManager: hostNm,
  };
  const guestSession: OnlineSession = {
    role: 'guest',
    localPlayerId: 'P2',
    remotePlayerId: 'P1',
    transport: b,
    networkManager: guestNm,
  };
  const createMatchIdentity = () => ({ matchId: 'm', seed: 7 });

  const hostCoord = new OnlineGameCoordinator({
    session: hostSession,
    createMatchIdentity,
    ...(options.hostAckTimeoutMs !== undefined ? { hostAckTimeoutMs: options.hostAckTimeoutMs } : {}),
    hostMovementNow: options.hostMovementNow,
  });
  const guestCoord = new OnlineGameCoordinator({ session: guestSession, createMatchIdentity });

  // 2. Lobby：双方 PLAYER_READY → Host 汇齐 → GAME_START
  const hostBoots: OnlineBattleBootstrap[] = [];
  const guestBoots: OnlineBattleBootstrap[] = [];
  const hostDisconnected: Mock<(reason?: string) => void> = vi.fn();
  const guestDisconnected: Mock<(reason?: string) => void> = vi.fn();
  hostCoord.enterLobby({
    onStart: (boot) => {
      hostBoots.push(boot);
    },
    onDisconnected: hostDisconnected,
  });
  guestCoord.enterLobby({
    onStart: (boot) => {
      guestBoots.push(boot);
    },
    onDisconnected: guestDisconnected,
  });
  await hostNm.connect();
  await guestNm.connect();
  hostCoord.sendPlayerReady();
  guestCoord.sendPlayerReady();
  if (options.latencyMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, options.latencyMs! * 2 + 10));
  }
  await flushLoopback();

  const hostBoot = hostBoots[0];
  const guestBoot = guestBoots[0];
  if (hostBoot === undefined || guestBoot === undefined) {
    throw new Error('[harness] GAME_START handshake failed');
  }

  // 3. 双端状态：Host 同参构建；Guest 从权威快照重建（同源保证）
  const hostState = createInitialGameState({ matchId: 'm', seed: 7 });
  const guestState = stateFromSnapshot(guestBoot.gameStart.initialState);

  // 4. 真实 GameLogic（Projectile 假 launch —— node 无 Phaser；
  //    GameLogic 调用的是 systems.projectile.launch 属性，假体须包一层对象）
  const makeSide = (state: GameState) => {
    const bus = new InMemoryCommandBus();
    const launch: Mock<(command: FireCommand) => void> = vi.fn();
    const logic = new GameLogic(state, bus, {
      movement: new MovementSystem(),
      fire: new FireSystem(),
      projectile: { launch } as unknown as ProjectileSystem,
    });
    const turn = new TurnManager(state);
    turn.startMatch();
    return { bus, launch, logic, turn };
  };
  const hostSide = makeSide(hostState);
  const guestSide = makeSide(guestState);

  const hostResume: Mock<() => void> = vi.fn();
  const guestResume: Mock<() => void> = vi.fn();
  const hostShowDamage: Mock<(result: DamageResult) => void> = vi.fn();
  const guestShowDamage: Mock<(result: DamageResult) => void> = vi.fn();
  const hostRejected: Mock<(payload: CommandRejectedPayload) => void> = vi.fn();
  const guestRejected: Mock<(payload: CommandRejectedPayload) => void> = vi.fn();
  const hostSyncStateChange: Mock<(state: unknown, detail?: string) => void> = vi.fn();
  const guestSyncStateChange: Mock<(state: unknown, detail?: string) => void> = vi.fn();
  const hostSyncFailure: Mock<() => void> = vi.fn();
  const guestSyncFailure: Mock<() => void> = vi.fn();
  const guestSetSyncLock: Mock<(locked: boolean) => void> = vi.fn();
  const guestSnapshotApplied: Mock<(snapshot: AuthoritativeGameSnapshot) => void> = vi.fn();

  if (attach) {
    hostCoord.attach({
      getState: () => hostState,
      commandBus: hostSide.bus,
      gameLogic: hostSide.logic,
      turnManager: hostSide.turn,
      resumeNextTurn: hostResume,
      showAuthoritativeDamage: hostShowDamage,
      showRejected: hostRejected,
      onDisconnected: hostDisconnected,
      onSyncStateChange: hostSyncStateChange,
      onSyncFailure: hostSyncFailure,
    });
    guestCoord.attach({
      getState: () => guestState,
      commandBus: guestSide.bus,
      gameLogic: guestSide.logic,
      turnManager: guestSide.turn,
      resumeNextTurn: guestResume,
      showAuthoritativeDamage: guestShowDamage,
      showRejected: guestRejected,
      onDisconnected: guestDisconnected,
      setSyncLock: guestSetSyncLock,
      onSnapshotApplied: guestSnapshotApplied,
      onSyncStateChange: guestSyncStateChange,
      onSyncFailure: guestSyncFailure,
    });
    await flushLoopback(1);
  }

  return {
    hostCoord,
    guestCoord,
    hostNm,
    guestNm,
    hostTransport: a,
    guestTransport: b,
    hostState,
    guestState,
    hostBus: hostSide.bus,
    guestBus: guestSide.bus,
    hostLogic: hostSide.logic,
    guestLogic: guestSide.logic,
    hostLaunch: hostSide.launch,
    guestLaunch: guestSide.launch,
    hostTurn: hostSide.turn,
    guestTurn: guestSide.turn,
    hostResume,
    guestResume,
    hostShowDamage,
    guestShowDamage,
    hostRejected,
    guestRejected,
    hostDisconnected,
    guestDisconnected,
    hostSyncStateChange,
    guestSyncStateChange,
    hostSyncFailure,
    guestSyncFailure,
    guestSetSyncLock,
    guestSnapshotApplied,
    hostBoot,
    guestBoot,
    hostBootCount: hostBoots.length,
    guestBootCount: guestBoots.length,
    dispose: () => {
      hostCoord.dispose();
      guestCoord.dispose();
      a.close();
      b.close();
    },
    flush: (rounds?: number) => flushLoopback(rounds),
  };
}

/** 把双端回合推进到 P2 回合（模拟上一回合已收口；turnId 保持 1） */
export function advanceToP2Turn(h: OnlineHarness): void {
  h.hostTurn.beginTurn('P2');
  h.guestTurn.beginTurn('P2');
}
