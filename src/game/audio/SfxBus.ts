import Phaser from 'phaser';
import { getUserSettings } from '../settings/UserSettings';

/**
 * Phase 17 Juice —— 音效 key / 素材清单（BootScene 预加载）。
 * 既有素材由 generate_sound_effect 生成，章鱼吼叫由低频谐波/噪声程序合成，
 * 保持复古街机卡通风，与像素海港美术同调；
 * 位于 public/assets/sfx/。
 */
export const SFX = {
  launch: 'sfx-launch',
  explosion: 'sfx-explosion',
  hit: 'sfx-hit',
  turn: 'sfx-turn',
  victory: 'sfx-victory',
  defeat: 'sfx-defeat',
  load: 'sfx-load',
  /** 界面按钮机械点击（MenuButton / AimButton zone onDown） */
  click: 'sfx-click',
  /** 章鱼激光：粒子聚集蓄力（charging 阶段进入时） */
  laserCharge: 'sfx-laser-charge',
  /** 章鱼激光：光束扫射（sweeping 阶段进入时） */
  laserSweep: 'sfx-laser-sweep',
  /** 章鱼被击败：低沉怪兽吼叫，与消融开始同步。 */
  octopusDeath: 'sfx-octopus-death',
} as const;

/** 音效缓存 key（= SFX 的值口径，'sfx-launch' …） */
export type SfxKey = (typeof SFX)[keyof typeof SFX];

export const SFX_FILES = [
  [SFX.launch, 'launch.mp3'],
  [SFX.explosion, 'explosion.mp3'],
  [SFX.hit, 'hit.mp3'],
  [SFX.turn, 'turn.mp3'],
  [SFX.victory, 'victory.mp3'],
  [SFX.defeat, 'defeat.mp3'],
  [SFX.load, 'load.mp3'],
  [SFX.click, 'click.mp3'],
  [SFX.laserCharge, 'laser-charge.mp3'],
  [SFX.laserSweep, 'laser-sweep.mp3'],
  [SFX.octopusDeath, 'octopus-death.mp3'],
] as const;

/** 首版音量基线（手感调参随试玩反馈迭代） */
const SFX_VOLUME: Record<SfxKey, number> = {
  [SFX.launch]: 0.5,
  [SFX.explosion]: 0.6,
  [SFX.hit]: 0.5,
  [SFX.turn]: 0.4,
  [SFX.victory]: 0.55,
  [SFX.defeat]: 0.55,
  [SFX.load]: 0.5,
  [SFX.click]: 0.4,
  [SFX.laserCharge]: 0.5,
  [SFX.laserSweep]: 0.55,
  [SFX.octopusDeath]: 0.65,
};

/**
 * 轻量音效总线（无状态：仅持 scene 引用；场景与 UI/系统组件可各持一实例）。
 *
 * - UserSettings.soundEnabled 播放时门禁（主菜单 SOUND 开关即时生效）
 * - 素材缺失静默跳过（加载失败不炸 —— 与美术 Graphics 回退同原则）
 * - 全部音效单次播放；炮弹飞行保持安静，发射与命中各播一次
 * - 界面按钮（MenuButton / AimButton）onDown 播机械 click
 * - 章鱼激光动画（OctopusTentacle）按阶段播 charge / sweep，双端各播自己的本地动画
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
