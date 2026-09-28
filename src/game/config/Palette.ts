/**
 * 占位视觉调色板（Phase 1～9 均为 placeholder 风格）。
 * 正式美术资产入场（Phase 17）前，所有占位绘制统一从这里取色。
 */
export const PALETTE = {
  /** 天空 / 游戏背景（PhaserGameConfig.backgroundColor 同步引用） */
  sky: '#1a2233',

  groundFill: 0x2f3a4f,
  groundTop: 0x56698a,

  band: 0xffffff,
  midfield: 0xffffff,
  zoneLine: 0x8fa3c7,
  tickLabel: '#63769b',

  barrel: 0xd8dee9,
  head: 0xe8eef7,

  P1: 0x3f8cff,
  P2: 0xff5063,
} as const;

export function playerColor(playerId: 'P1' | 'P2'): number {
  return playerId === 'P1' ? PALETTE.P1 : PALETTE.P2;
}

/** 数值色转 Phaser Text 用的 CSS 颜色 */
export function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
