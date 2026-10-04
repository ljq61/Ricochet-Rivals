import Phaser from 'phaser';
import { getUserSettings, onSoundSettingChanged } from '../settings/UserSettings';

import { SFX, type SfxKey } from '../config/SfxAssets';

// Keep existing gameplay imports compatible while build tools consume the pure manifest.
export { SFX, SFX_FILES, type SfxKey } from '../config/SfxAssets';

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
