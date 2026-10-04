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
