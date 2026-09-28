import Phaser from 'phaser';

/**
 * Matter 库的运行时访问桥。
 *
 * 坑（2026-09-28 实测）：
 * - `MatterJS` 只存在于 Phaser 的类型声明里，运行时没有这个全局变量，
 *   直接引用 `MatterJS.Body.xxx` 会抛 ReferenceError 导致渲染循环崩溃（黑屏）。
 * - Phaser 4 运行时把 Matter 库暴露在 `Phaser.Physics.Matter.Matter`，
 *   但对应 .d.ts 命名空间是空的，无法直接以类型安全方式访问。
 *
 * 本模块做一次受控断言，把运行时对象桥接到 `MatterJS` 的静态类类型上；
 * 全项目统一从这里引用 Matter 库（Body.setPosition / setVelocity）。
 */
interface MatterLibShape {
  readonly Body: typeof MatterJS.Body;
}

export const MatterLib: MatterLibShape = (
  Phaser.Physics.Matter as unknown as { Matter: MatterLibShape }
).Matter;
