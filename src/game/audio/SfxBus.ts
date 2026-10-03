import Phaser from 'phaser';
import { getUserSettings, onSoundSettingChanged } from '../settings/UserSettings';

/**
 * Phase 17 Juice —— 音效 key / 素材清单（BootScene 预加载）。
 * 既有素材由 generate_sound_effect 生成，章鱼吼叫由低频谐波/噪声程序合成，
 * 空袭引擎与下落哨声来自外部授权素材，署名见 public/assets/sfx/SOURCES.md；
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
  itemPickup: 'sfx-item-pickup',
  itemHeal: 'sfx-item-heal',
  itemReady: 'sfx-item-ready',
  itemHoming: 'sfx-item-homing',
  airstrikeEngine: 'sfx-airstrike-engine',
  airstrikeDrop: 'sfx-airstrike-drop',
  /** 章鱼激光：粒子聚集蓄力（charging 阶段进入时） */
  laserCharge: 'sfx-laser-charge',
  /** 章鱼激光：光束扫射（sweeping 阶段进入时） */
  laserSweep: 'sfx-laser-sweep',
  /** 章鱼被击败：低沉怪兽吼叫，与消融开始同步。 */
  octopusDeath: 'sfx-octopus-death',
  octopusSpawn: 'sfx-octopus-spawn',
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
  [SFX.itemPickup, 'item-pickup.wav'],
  [SFX.itemHeal, 'item-heal.wav'],
  [SFX.itemReady, 'item-ready.wav'],
  [SFX.itemHoming, 'item-homing.wav'],
  [SFX.airstrikeEngine, 'airstrike-engine.wav'],
  [SFX.airstrikeDrop, 'airstrike-drop.wav'],
  [SFX.laserCharge, 'laser-charge.mp3'],
  [SFX.laserSweep, 'laser-sweep.mp3'],
  [SFX.octopusDeath, 'octopus-death-roar.mp3'],
  [SFX.octopusSpawn, 'octopus-spawn-roar.wav'],
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
  [SFX.itemPickup]: 0.4,
  [SFX.itemHeal]: 0.4,
  [SFX.itemReady]: 0.3,
  [SFX.itemHoming]: 0.35,
  [SFX.airstrikeEngine]: 0.3,
  [SFX.airstrikeDrop]: 0.5,
  [SFX.laserCharge]: 0.5,
  [SFX.laserSweep]: 0.55,
  [SFX.octopusDeath]: 0.95,
  [SFX.octopusSpawn]: 0.7,
};

/**
 * 轻量音效总线（无状态：仅持 scene 引用；场景与 UI/系统组件可各持一实例）。
 *
 * - UserSettings.soundEnabled 播放时门禁（主菜单 SOUND 开关即时生效）
 * - 素材缺失静默跳过（加载失败不炸 —— 与美术 Graphics 回退同原则）
 * - 普通音效单次播放；制导弹锁定后循环提示音，由炮弹生命周期停止
 * - 界面按钮（MenuButton / AimButton）onDown 播机械 click
 * - 章鱼激光动画（OctopusTentacle）按阶段播 charge / sweep，双端各播自己的本地动画
 * - 联机不双播：发射/爆炸均挂本地模拟事件（双端各播一次自己的），
 *   权威 TURN_RESULT 路径不重复触发音频
 * - 场景 SHUTDOWN：显式停止循环音（声音管理器属于 Game，不属于 Scene）
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

  /** Cancellable one-shot. Muting ends it; unmuting never replays an old event. */
  playOwned(key: SfxKey): () => void {
    if (!getUserSettings().soundEnabled || !this.scene.cache.audio.exists(key)) return () => {};
    const sound = this.scene.sound.add(key, { volume: SFX_VOLUME[key], loop: false });
    let disposed = false;
    const stop = () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      this.scene.events.off('shutdown', stop);
      sound.off('complete', stop);
      sound.stop();
      sound.destroy();
    };
    const unsubscribe = onSoundSettingChanged(enabled => { if (!enabled) stop(); });
    this.scene.events.once('shutdown', stop);
    sound.once('complete', stop);
    sound.play();
    return stop;
  }

  /** Owned by the caller; muting destroys the sound, unmuting resumes one instance. */
  loop(key: SfxKey): () => void {
    let sound: Phaser.Sound.BaseSound | null = null;
    let disposed = false;
    const stopSound = () => {
      if (!sound) return;
      sound.stop();
      sound.destroy();
      sound = null;
    };
    const sync = (enabled: boolean) => {
      if (disposed) return;
      if (!enabled) { stopSound(); return; }
      if (sound || !this.scene.cache.audio.exists(key)) return;
      sound = this.scene.sound.add(key, { volume: SFX_VOLUME[key], loop: true });
      sound.play();
    };
    const unsubscribe = onSoundSettingChanged(sync);
    const stop = () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      this.scene.events.off('shutdown', stop);
      stopSound();
    };
    this.scene.events.once('shutdown', stop);
    sync(getUserSettings().soundEnabled);
    return stop;
  }
}
