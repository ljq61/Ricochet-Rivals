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
  load: 'sfx-load',
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
  [SFX.load, 'load.mp3'],
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
  [SFX.load]: 0.5,
};

/**
 * 轻量音效总线（每场景一实例；无跨场景共享状态）。
 *
 * - UserSettings.soundEnabled 播放时门禁（主菜单 SOUND 开关即时生效）
 * - 素材缺失静默跳过（加载失败不炸 —— 与美术 Graphics 回退同原则）
 * - 全部音效单次播放：炮弹飞行口哨随发射播一次（真机实测循环版在
 *   desync 恢复清场路径下永不停止 —— clearInFlightSimulations 无
 *   impact 事件可停循环；且 Doppler 循环听感重复。用户拍板单次），
 *   不再维护循环句柄 —— 循环类 bug 连根去除
 * - 联机不双播：发射/爆炸均挂本地模拟事件（双端各播一次自己的），
 *   权威 TURN_RESULT 路径不重复触发音频
 * - 场景 SHUTDOWN：Phaser 随场景销毁声音管理器，无跨场景泄漏
 */
export class SfxBus {
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
}
