import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInitialGameState, TurnPhase, type GameState } from '../src/game/state/GameState';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  Physics: { Matter: { Matter: {} } },
  Cameras: { Scene2D: { Events: { FADE_OUT_COMPLETE: 'fadecomplete' } } },
} }));

let BattleScene: typeof import('../src/game/scenes/BattleScene').BattleScene;

beforeAll(async () => {
  // Scene imports inspect the manual-online query; no browser renderer is needed.
  vi.stubGlobal('window', { location: { search: '' } });
  ({ BattleScene } = await import('../src/game/scenes/BattleScene'));
});

afterAll(() => vi.unstubAllGlobals());

interface PendingRecovery {
  attemptRecovery: () => Promise<'RECOVERED'>;
}

/** Exercise real scene methods; only Phaser services and external effects are stubbed. */
interface LifecycleScene {
  state: GameState;
  roomRecovery: PendingRecovery | null;
  presentationEpoch: number;
  connectionRecoveryActive: boolean;
  handedToResult: boolean;
  beginOnlineRecovery(recovery: PendingRecovery): Promise<void>;
  restoreSnapshotPresentation(): void;
  transitionToResult(): void;
  leaveToMainMenu(): void;
}

function fixture() {
  const scene = new BattleScene() as unknown as LifecycleScene;
  const state = createInitialGameState({ matchId: 'settings-lifecycle', seed: 1 });
  state.phase = TurnPhase.RESOLVE;
  let active = true;
  const fadeCallbacks: (() => void)[] = [];
  const fallbackCallbacks: (() => void)[] = [];
  const controls = { setEnabled: vi.fn() };
  const online = { role: 'guest', localPlayerId: 'P2', isLocalTurn: () => true,
    setConnectionRecoveryActive: vi.fn(), requestPostReconnectSync: vi.fn() };
  const octopus = { restore: vi.fn() };
  const start = vi.fn();
  Object.assign(scene, {
    state,
    scene: { isActive: () => active, start },
    controls,
    input: { keyboard: { resetKeys: vi.fn() } },
    inputRouter: { releaseAll: vi.fn() },
    aimController: { cancel: vi.fn() },
    cameraController: { cancelAim: vi.fn(), enableFreeView: vi.fn() },
    turnManager: { cancelAim: vi.fn() },
    turnBanner: { showMessage: vi.fn() },
    octopusTentacle: octopus,
    online,
    cameras: { main: { fadeOut: vi.fn(), once: (_event: string, callback: () => void) => {
      fadeCallbacks.push(callback);
    } } },
    time: { delayedCall: (_ms: number, callback: () => void) => {
      fallbackCallbacks.push(callback);
    } },
  });
  return { scene, state, controls, online, octopus, start,
    deactivate: () => { active = false; },
    completeFade: () => { fadeCallbacks.splice(0).forEach((callback) => callback()); },
    runFallback: () => { fallbackCallbacks.splice(0).forEach((callback) => callback()); },
  };
}

function pendingRecovery() {
  let finish!: (value: 'RECOVERED') => void;
  const attempt = new Promise<'RECOVERED'>((resolve) => { finish = resolve; });
  const recovery: PendingRecovery = { attemptRecovery: () => attempt };
  return { recovery, finish: () => finish('RECOVERED') };
}

describe('Battle settings exit and recovery lifecycle', () => {
  it('a normal snapshot during recovery still unlocks input and requests post-reconnect sync', async () => {
    const { scene, controls, online, octopus } = fixture();
    const { recovery, finish } = pendingRecovery();
    scene.roomRecovery = recovery;
    const pending = scene.beginOnlineRecovery(recovery);
    expect(scene.connectionRecoveryActive).toBe(true);
    expect(controls.setEnabled).toHaveBeenLastCalledWith(false);

    scene.restoreSnapshotPresentation();
    expect(scene.presentationEpoch).toBe(1);
    expect(octopus.restore).toHaveBeenCalledOnce();
    finish();
    await pending;

    expect(scene.connectionRecoveryActive).toBe(false);
    expect(online.setConnectionRecoveryActive.mock.calls).toEqual([[true], [false]]);
    expect(online.requestPostReconnectSync).toHaveBeenCalledOnce();
    expect(controls.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it.each(['replaced', 'disposed', 'inactive'] as const)(
    'ignores the old recovery continuation when its scene ownership is %s',
    async (change) => {
      const { scene, controls, online, deactivate } = fixture();
      const { recovery, finish } = pendingRecovery();
      scene.roomRecovery = recovery;
      const pending = scene.beginOnlineRecovery(recovery);
      if (change === 'replaced') scene.roomRecovery = pendingRecovery().recovery;
      if (change === 'disposed') scene.roomRecovery = null;
      if (change === 'inactive') deactivate();
      online.setConnectionRecoveryActive.mockClear();
      controls.setEnabled.mockClear();
      finish();
      await pending;

      expect(online.setConnectionRecoveryActive).not.toHaveBeenCalled();
      expect(online.requestPostReconnectSync).not.toHaveBeenCalled();
      expect(controls.setEnabled).not.toHaveBeenCalled();
    },
  );

  it('confirming exit suppresses a late recovery and snapshot while fading to the menu', async () => {
    const { scene, online, octopus, start, completeFade, runFallback } = fixture();
    const { recovery, finish } = pendingRecovery();
    scene.roomRecovery = recovery;
    const pending = scene.beginOnlineRecovery(recovery);
    scene.leaveToMainMenu();
    const exitEpoch = scene.presentationEpoch;
    scene.restoreSnapshotPresentation();
    finish();
    await pending;
    completeFade();
    runFallback();

    expect(scene.presentationEpoch).toBe(exitEpoch);
    expect(octopus.restore).not.toHaveBeenCalled();
    expect(online.setConnectionRecoveryActive.mock.calls).toEqual([[true]]);
    expect(online.requestPostReconnectSync).not.toHaveBeenCalled();
    expect(start.mock.calls).toEqual([['MainMenuScene']]);
  });

  it('confirming exit wins over an already queued game-over fade without handing off the session', () => {
    const { scene, state, start, completeFade, runFallback } = fixture();
    state.gameOver = true;
    state.phase = TurnPhase.GAME_OVER;
    state.winnerId = 'P1';
    scene.transitionToResult();
    scene.leaveToMainMenu();
    completeFade();
    runFallback();
    scene.transitionToResult();

    expect(start.mock.calls).toEqual([['MainMenuScene']]);
    expect(scene.handedToResult).toBe(false);
  });

  it('does not reclaim a session already handed to the result scene', () => {
    const { scene, state, start, completeFade, runFallback } = fixture();
    state.gameOver = true;
    state.phase = TurnPhase.GAME_OVER;
    scene.transitionToResult();
    completeFade();
    expect(scene.handedToResult).toBe(true);
    scene.leaveToMainMenu();
    completeFade();
    runFallback();

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]?.[0]).toBe('ResultScene');
  });
});
