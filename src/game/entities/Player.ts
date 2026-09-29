import Phaser from 'phaser';
import { PALETTE, playerColor, toCssColor } from '../config/Palette';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';
import {
  ART,
  WALK_ART,
  PLAYER_ART_BOUNDS,
  AIM_POSE_BOUNDS,
  aimPoseKey,
  bucketAimPoseAngle,
  type ArtBounds,
} from '../config/ArtAssets';
import { GAME_CONFIG } from '../config/GameConfig';

/**
 * 玩家视觉实体（渲染层）。
 *
 * - 不持有任何规则逻辑；位置完全由 PlayerState 驱动（每帧同步）
 * - 按实际位移播放 8 帧走路序列；缺素材时回退轻微起伏
 * - 朝向随移动方向翻转，初始朝向战场中央
 * - Phase 17 修复轮：瞄准姿态序列（15–75° 抬枪图，setAimPose 按
 *   仰角分桶切换纹理；素材缺失自动回退 idle，Graphics 占位不受影响）
 *
 * State 不持有 Phaser 对象；该实体通过引用的 PlayerState 数据渲染，
 * 符合「渲染层读取 State」的分层规则。
 */
export class Player {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly barrel: Phaser.GameObjects.Graphics;
  private readonly sprite: Phaser.GameObjects.Image | null;
  private readonly playerId: PlayerId;

  private facing: 1 | -1;
  private lastX: number;
  private bobPhase = 0;
  private walking = false;
  private walkDistance = 0;
  private reactionHoldMs = 0;
  private idleTimeMs = 0;
  private hitTween: Phaser.Tweens.Tween | null = null;
  /** 当前姿态纹理 key（null=idle；幂等切换短路用） */
  private currentPoseKey: string | null;

  constructor(scene: Phaser.Scene, playerState: PlayerState) {
    this.scene = scene;
    this.playerId = playerState.id;
    this.facing = playerState.side === 'left' ? 1 : -1;
    this.lastX = playerState.x;
    this.currentPoseKey = ART[playerState.id];

    const color = playerColor(playerState.id);
    const { width, height } = GAME_CONFIG.player.collision;

    // 身体 + 头（静态，绘制一次）
    const body = scene.add.graphics();
    body.fillStyle(color, 1);
    body.fillRoundedRect(-width * 0.3, -height / 2, width * 0.6, height / 2, 12);
    body.fillStyle(PALETTE.head, 1);
    body.fillCircle(0, -height * 0.75, height / 4);

    // 炮管（随朝向重绘）
    this.barrel = scene.add.graphics();
    const artBounds = PLAYER_ART_BOUNDS[playerState.id];
    this.sprite = scene.textures.exists(ART[playerState.id])
      ? scene.add.image(0, 0, ART[playerState.id])
      : null;
    if (this.sprite) {
      this.applySpriteFit(artBounds);
      body.setVisible(false);
      this.barrel.setVisible(false);
    }

    const label = scene.add
      .text(0, -height - 24, playerState.id, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: toCssColor(color),
        stroke: '#151c22',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.container = scene.add.container(playerState.x, playerState.y, [
      body,
      this.barrel,
      label,
    ]);
    if (this.sprite) this.container.addAt(this.sprite, 1);

    this.redrawBarrel();
  }

  /** 每帧从 PlayerState 同步视觉（位移驱动走路序列） */
  update(playerState: PlayerState, deltaMs: number): void {
    // Local visual hold only. State and collision bodies continue to update normally.
    if (this.reactionHoldMs > 0) {
      this.reactionHoldMs = Math.max(0, this.reactionHoldMs - deltaMs);
      return;
    }
    const deltaX = playerState.x - this.lastX;
    this.lastX = playerState.x;

    const moving = Math.abs(deltaX) > 0.001;
    if (moving) {
      this.facing = deltaX > 0 ? 1 : -1;
      this.redrawBarrel();
    }

    const walk = WALK_ART[this.playerId];
    this.walking = moving && this.sprite !== null && this.scene.textures.exists(walk.key);
    if (this.walking && this.sprite) {
      // Distance-driven cadence also works for AI and remote authoritative movement.
      this.walkDistance += Math.min(Math.abs(deltaX), 16);
      const frame = Math.floor(this.walkDistance / 12) % 8;
      this.sprite.setTexture(walk.key, frame)
        .setScale(GAME_CONFIG.player.collision.height / walk.visibleHeight)
        .setOrigin(0.5, walk.soles[frame]! / this.sprite.frame.height);
      this.currentPoseKey = walk.key;
    } else if (this.currentPoseKey === walk.key) {
      this.walkDistance = 0;
      this.setAimPose(null);
    }

    let bob = 0;
    if (moving && !this.walking) {
      this.bobPhase += (deltaMs / 1000) * 24;
      bob = Math.sin(this.bobPhase) * 3;
    } else {
      this.bobPhase = 0;
    }

    this.idleTimeMs += deltaMs;
    if (this.hitTween === null) {
      const breath = this.walking ? 0 : Math.sin(this.idleTimeMs / 320) * 0.012;
      this.container.setScale(1 - breath * 0.4, 1 + breath)
        .setAngle(moving ? Math.sin(this.bobPhase) * 2 : 0);
    }
    this.container.setPosition(playerState.x, playerState.y + Math.min(0, bob));
  }

  /**
   * 受击反馈：70ms 表现停顿、压缩后仰，再弹性恢复。
   * 纯视觉（渲染层自行管理 Tween），不读取 / 不修改 PlayerState；
   * 重复触发时重启，避免动画叠加。
   */
  playHitReaction(): void {
    this.hitTween?.stop();
    this.reactionHoldMs = 70;
    this.container.setAlpha(1).setScale(1.12, 0.88).setAngle(-this.facing * 7);
    this.hitTween = this.scene.tweens.add({
      targets: this.container,
      alpha: { from: 0.65, to: 1 },
      scaleX: 1, scaleY: 1, angle: 0,
      delay: 70, duration: 320, ease: 'Back.easeOut',
      onComplete: () => {
        this.container.setAlpha(1);
        this.hitTween = null;
      },
    });
  }

  /** Recoil is anchored at the feet; it cannot move the logical player. */
  playFireReaction(): void {
    this.hitTween?.stop();
    this.container.setScale(1.08, 0.94).setAngle(-this.facing * 5);
    this.hitTween = this.scene.tweens.add({
      targets: this.container, scaleX: 1, scaleY: 1, angle: 0, alpha: 1,
      duration: 240, ease: 'Back.easeOut', onComplete: () => { this.hitTween = null; },
    });
  }

  /** Phase 17 修复轮：外部（瞄准流程）驱动朝向 —— 跟随抛物线发射方向 */
  setFacing(facing: 1 | -1): void {
    if (this.facing === facing) {
      return;
    }
    this.facing = facing;
    this.redrawBarrel();
  }

  /**
   * Phase 17 修复轮：瞄准抬枪姿态。elevationDeg = 发射方向仰角
   * （0–90°）；null 回 idle。按 bucket 分桶切换序列图纹理；姿态素材
   * 缺失时保持当前（含 idle 回退）。幂等：同 key 短路。
   */
  setAimPose(elevationDeg: number | null): void {
    if (this.sprite === null) {
      return; // 无美术（Graphics 占位路径）：姿态序列不可用
    }
    if (elevationDeg === null && this.walking) return;
    const pose = elevationDeg === null ? null : bucketAimPoseAngle(elevationDeg);
    const key = pose === null
      ? ART[this.playerId]
      : aimPoseKey(this.playerId, pose);
    if (key === this.currentPoseKey) {
      return;
    }
    if (pose !== null && !this.scene.textures.exists(key)) {
      return; // 姿态图缺失：保持当前姿态（回退不越级）
    }
    this.currentPoseKey = key;
    this.sprite.setTexture(key);
    this.applySpriteFit(
      pose === null
        ? PLAYER_ART_BOUNDS[this.playerId]
        : AIM_POSE_BOUNDS[this.playerId][pose],
    );
  }

  /** 素材适配：可见高度 = 碰撞高，脚底锚点 = bottom/sourceHeight（统一口径） */
  private applySpriteFit(bounds: ArtBounds): void {
    const height = GAME_CONFIG.player.collision.height;
    this.sprite
      ?.setScale(height / (bounds.bottom - bounds.top))
      .setOrigin(0.5, bounds.bottom / bounds.sourceHeight);
  }

  private redrawBarrel(): void {
    this.sprite?.setFlipX(this.facing < 0);
    this.barrel.clear();
    this.barrel.lineStyle(10, PALETTE.barrel, 1);
    const y = GAME_CONFIG.player.launcher.offsetY;
    this.barrel.lineBetween(0, y, this.facing * 56, y);
  }
}
