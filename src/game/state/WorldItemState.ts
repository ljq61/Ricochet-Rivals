import type { WorldItemType } from './ids';

/**
 * 空中道具状态。V0.1 只定义（架构预留），不实现 Gameplay。
 * 位置规则见 PRD §29：道具应偏离最优攻击弹道。
 */
export interface WorldItemState {
  id: string;
  type: WorldItemType;
  x: number;
  y: number;
  active: boolean;
}
