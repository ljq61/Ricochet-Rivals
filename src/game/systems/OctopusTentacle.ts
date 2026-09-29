import Phaser from 'phaser';
import { ART, SHEET_GRID } from '../config/ArtAssets';
import { GAME_CONFIG } from '../config/GameConfig';
import { COLLISION_CATEGORY } from '../physics/collisionCategories';
import { shouldOctopusEmerge } from './octopusTrigger';
import type { PlayerId } from '../state/ids';
import type { PlayerState } from '../state/PlayerState';

const OCTOPUS_ANIM_KEY = 'fx-octopus-idle-loop';
const FRAME_COUNT = SHEET_GRID.cols * SHEET_GRID.rows;

/**
 * 中央章鱼触手（Phase 17 玩法特性）：任一方 HP ≤ 阈值时从战场中央
 * 海里升起 —— 16 帧待机序列动画 + 静态碰撞体阻挡中低弹道（撞上即爆），
 * 逼双方改打高抛物线。
 *
 * 联机确定性：出现条件只由 PlayerState HP 驱动；HP 只在回合结算
 * （TURN_RESULT / 快照）更新，炮弹飞行期间触手状态恒定 → 双端本地
 * 模拟一致，不影响 stateHash。碰撞体在激活瞬间即建（视觉升起是
 * 纯表现层 tween）。场景重建（再战 / 恢复换场）自然复位。
 * 素材缺失时特性整体关闭（玩法回退为无阻挡 —— 隐形墙不可接受）。
 */
export class OctopusTentacle {
  private active = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /** 是否已升起（debug / E2E 观测口） */
  get isActive(): boolean {
    return this.active;
  }

  /** 每帧幂等刷新（State 是唯一数据源；出现后常驻） */
  refresh(players: Record<PlayerId, PlayerState>): void {
    if (this.active) {
      return;
    }
    if (!this.scene.textures.exists(ART.octopus)) {
      return;
    }
    if (!shouldOctopusEmerge(players.P1.hp, players.P2.hp)) {
      return;
    }
    this.activate();
  }

  private activate(): void {
    this.active = true;
    const cfg = GAME_CONFIG.octopus;
    this.ensureAnim();
    // 自海中升起（起始浸没 + 渐显；碰撞体已即刻生效，双端一致）
    const sprite = this.scene.add
      .sprite(cfg.x, cfg.baseY + 300, ART.octopus)
      .setOrigin(0.5, 1)
      .setDisplaySize(cfg.width, cfg.height)
      .setDepth(-6) // 前景水面(-5)之后：底部没入水带，如自海里长出
      .setAlpha(0);
    sprite.play({
      key: OCTOPUS_ANIM_KEY,
      startFrame: Math.floor(Math.random() * FRAME_COUNT), // 纯视觉错帧（§16）
    });
    this.scene.tweens.add({
      targets: sprite,
      y: cfg.baseY,
      alpha: 1,
      duration: 900,
      ease: 'Sine.easeOut',
    });
    // 待机摇摆：素材 sheet 剪影恒定（保证与碰撞体始终匹配），生命感由
    // 程序补 —— 底枢 ±1.4° 慢摆（origin(0.5,1) = 底部锚定，顶部 ±~19px）
    this.scene.tweens.add({
      targets: sprite,
      rotation: { from: -0.025, to: 0.025 },
      duration: 2600,
      delay: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    // 静态阻挡体：占显示尺寸比例收窄（"一定程度"阻挡：贴边擦过、
    // 擦过最高尖端可过）；中央爆炸距双方基地 >2000px = 零伤害
    const bodyWidth = cfg.width * cfg.collisionWidthRatio;
    const bodyHeight = cfg.height * cfg.collisionHeightRatio;
    this.scene.matter.add.rectangle(
      cfg.x,
      cfg.baseY - bodyHeight / 2,
      bodyWidth,
      bodyHeight,
      {
        isStatic: true,
        label: 'octopus-tentacle',
        collisionFilter: {
          category: COLLISION_CATEGORY.OBSTACLE,
          mask: COLLISION_CATEGORY.PROJECTILE,
        },
      }
    );
  }

  private ensureAnim(): void {
    if (this.scene.anims.exists(OCTOPUS_ANIM_KEY)) {
      return;
    }
    this.scene.anims.create({
      key: OCTOPUS_ANIM_KEY,
      frames: this.scene.anims.generateFrameNumbers(ART.octopus, {
        start: 0,
        end: FRAME_COUNT - 1,
      }),
      frameRate: 8,
      repeat: -1,
    });
  }
}
