import type { PlayerId } from '../state/ids';

/**
 * InputSource 契约（架构文档 §2 / TASKS Contracts）。
 * Human / AI / Network 各自实现，统一产出 GameCommand；
 * Game Logic 不感知来源。未来屏幕 UI 虚拟摇杆实现同一接口即可接入。
 */
export interface InputSource {
  readonly playerId: PlayerId;

  setEnabled(enabled: boolean): void;

  update(deltaMs: number): void;

  destroy(): void;
}
