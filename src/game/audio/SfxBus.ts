import Phaser from 'phaser';
import { getUserSettings } from '../settings/UserSettings';

/**
 * Phase 17 Juice —— 音效 key / 素材清单（BootScene 预加载）。
 * 素材由 generate_sound_effect 生成（复古街机卡通风，与像素海港美术同调），
 * 位于 public/assets/sfx/。
 */
export const SFX = {
  launch: 'sfx-launch',
  projectile: 'sfx-projectile',
  explosion: 'sfx-explosion',
  hit: 'sfx-hit',
  turn: 'sfx-turn',
  victory: 'sfx-victory',
  defeat: 'sfx-defeat',
} as const;

/** 音效缓存 key（= SFX 的值口径，'sfx-launch' …） */
export type SfxKey = (typeof SFX)[keyof typeof SFX];

export const SFX_FILES = [
  [SFX.launch, 'launch.mp3'],
  [SFX.projectile, 'projectile.mp3'],
  [SFX.explosion, 'explosion.mp3'],
  [SFX.hit, 'hit.mp3'],
  [SFX.turn, 'turn.mp3'],
  [SFX.victory, 'victory.mp3'],
  [SFX.defeat, 'defeat.mp3'],
] as const;

/** 首版音量基线（手感调参随试玩反馈迭代） */
const SFX_VOLUME: Record<SfxKey, number> = {
  [SFX.launch]: 0.5,
  [SFX.projectile]: 0.35,
  [SFX.explosion]: 0.6,
  [SFX.hit]: 0.5,
  [SFX.turn]: 0.4,
  [SFX.victory]: 0.55,
  [SFX.defeat]: 0.55,
};

/**
 * 轻量音效总线（每场景一实例；无跨场景共享状态）。
 *
 * - UserSettings.soundEnabled 播放时门禁（主菜单 SOUND 开关即时生效）
 * - 素材缺失静默跳过（加载失败不炸 —— 与美术 Graphics 回退同原则）
 * - 单循环句柄（炮弹飞行口哨）：startLoop 幂等顶替、stopLoop 幂等；
 *   本作一回合仅一发，双循环不存在
 * - 联机不双播：发射/爆炸均挂本地模拟事件（双端各播一次自己的），
 *   权威 TURN_RESULT 路径不重复触发音频
 * - 场景 SHUTDOWN：Phaser 随场景销毁声音管理器，destroy() 兜底停循环
 */
export class SfxBus {
  private loopSound: Phaser.Sound.BaseSound | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  play(key: SfxKey): void {
    if (!getUserSettings().soundEnabled) {
      return;
    }
    if (!this.scene.cache.audio.exists(key)) {
      return;
    }
    this.scene.sound.play(key, { volume: SFX_VOLUME[key] });
  }

  startLoop(key: SfxKey): void {
    this.stopLoop();
    if (!getUserSettings().soundEnabled) {
      return;
    }
    if (!this.scene.cache.audio.exists(key)) {
      return;
    }
    this.loopSound = this.scene.sound.add(key, {
      loop: true,
      volume: SFX_VOLUME[key],
    });
    this.loopSound.play();
  }

  stopLoop(): void {
    this.loopSound?.stop();
    this.loopSound?.destroy();
    this.loopSound = null;
  }

  destroy(): void {
    this.stopLoop();
  }
}
