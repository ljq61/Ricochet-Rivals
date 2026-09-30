import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { Player } from '../../src/game/entities/Player';
import { createPlayerState } from '../../src/game/state/GameState';
import { ART, WALK_ART, aimPoseKey } from '../../src/game/config/ArtAssets';
import type { PlayerId } from '../../src/game/state/ids';

vi.mock('phaser', () => ({ default: {} }));

function fluent<T extends string>(methods: T[]) {
  const object = {} as Record<T, ReturnType<typeof vi.fn>>;
  for (const method of methods) object[method] = vi.fn(() => object);
  return object;
}

function setup(playerId: PlayerId) {
  const state = createPlayerState(playerId);
  const sprite = {
    ...fluent(['setScale', 'setOrigin', 'setTexture', 'setFlipX']),
    frame: { height: 512 },
  };
  sprite.setTexture.mockImplementation((key: string, frame = 0) => {
    const walk = WALK_ART[playerId];
    if (key === walk.key && 'rowBounds' in walk) {
      const row = (walk.rowBounds as readonly { top: number; bottom: number }[])[Math.floor(frame / walk.cols)]!;
      sprite.frame.height = row.bottom - row.top;
    } else if (key === walk.key) {
      sprite.frame.height = 443;
    }
    return sprite;
  });
  const scene = {
    textures: { exists: () => true },
    add: {
      graphics: () => fluent(['fillStyle', 'fillRoundedRect', 'fillCircle', 'setVisible', 'clear', 'lineStyle', 'lineBetween']),
      image: () => sprite,
      text: () => fluent(['setOrigin']),
      container: () => fluent(['addAt', 'setScale', 'setAngle', 'setPosition']),
    },
  } as unknown as Phaser.Scene;
  const player = new Player(scene, state);
  return { player, state, sprite };
}

function moveDistance(harness: ReturnType<typeof setup>, distance: number, deltaMs = 16): void {
  // Use realistic small updates; large network corrections are intentionally capped by Player.
  let remaining = Math.abs(distance);
  while (remaining > 0) {
    const step = Math.min(remaining, 12);
    harness.state.x += Math.sign(distance) * step;
    harness.player.update(harness.state, deltaMs);
    remaining -= step;
  }
}

function originFor(id: PlayerId, frame: number): number {
  const walk = WALK_ART[id];
  return 'originsX' in walk ? walk.originsX[frame]! : walk.originX;
}

describe('Player — distance-driven walk rendering', () => {
  it.each(['P1', 'P2'] as const)('%s traverses every configured frame over its own full stride', (id) => {
    const harness = setup(id);
    const { sprite } = harness;
    const walk = WALK_ART[id];
    const frameCount = walk.cols * walk.rows;
    const step = walk.strideDistance / frameCount;
    for (let i = 1; i <= frameCount; i++) {
      moveDistance(harness, step);
      const frame = i % frameCount;
      expect(sprite.setTexture).toHaveBeenLastCalledWith(walk.key, frame);
      expect(sprite.setOrigin).toHaveBeenLastCalledWith(originFor(id, frame), walk.soles[frame]! / sprite.frame.height);
    }
  });

  it('keeps the complete red cycle while moving left and flips with direction', () => {
    const harness = setup('P2');
    const { sprite } = harness;
    const frameCount = WALK_ART.P2.cols * WALK_ART.P2.rows;
    const step = WALK_ART.P2.strideDistance / frameCount;
    for (let i = 1; i <= frameCount; i++) {
      moveDistance(harness, -step);
      expect(sprite.setTexture).toHaveBeenLastCalledWith(WALK_ART.P2.key, i % frameCount);
      expect(sprite.setFlipX).toHaveBeenLastCalledWith(true);
      expect(sprite.setOrigin).toHaveBeenLastCalledWith(
        1 - originFor('P2', i % frameCount),
        WALK_ART.P2.soles[i % frameCount]! / sprite.frame.height,
      );
    }
    moveDistance(harness, step);
    expect(sprite.setFlipX).toHaveBeenLastCalledWith(false);
    expect(sprite.setOrigin).toHaveBeenLastCalledWith(
      originFor('P2', 1),
      WALK_ART.P2.soles[1]! / sprite.frame.height,
    );
  });

  it('returns to idle on stop and starts a fresh stride on subsequent movement', () => {
    const harness = setup('P2');
    const { player, state, sprite } = harness;
    state.x += 12;
    player.update(state, 16);
    player.update(state, 16);
    expect(sprite.setTexture).toHaveBeenLastCalledWith(ART.P2);
    moveDistance(harness, WALK_ART.P2.strideDistance / (WALK_ART.P2.cols * WALK_ART.P2.rows));
    expect(sprite.setTexture).toHaveBeenLastCalledWith(WALK_ART.P2.key, 1);
  });

  it('uses a 120px red half-cycle and preserves frames for equal distance at different update durations', () => {
    const fast = setup('P2');
    const slow = setup('P2');
    expect(WALK_ART.P2.strideDistance).toBe(240);
    moveDistance(fast, 120, 8);
    moveDistance(slow, 120, 32);
    expect(fast.sprite.setTexture).toHaveBeenLastCalledWith(WALK_ART.P2.key, 4);
    expect(slow.sprite.setTexture).toHaveBeenLastCalledWith(WALK_ART.P2.key, 4);
    moveDistance(fast, 120, 8);
    expect(fast.sprite.setTexture).toHaveBeenLastCalledWith(WALK_ART.P2.key, 0);
  });

  it('does not replace a stationary aiming pose with the walk or idle texture', () => {
    const { player, state, sprite } = setup('P2');
    player.setAimPose(45);
    player.update(state, 16);
    expect(sprite.setTexture).toHaveBeenLastCalledWith(aimPoseKey('P2', 45));
  });
});
