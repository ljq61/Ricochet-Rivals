/**
 * Camera 视野计算纯函数（不依赖 Phaser，可直接单测）。
 *
 * Phaser 相机 zoom 语义（见 phaser/src/cameras/2d/Camera.js preRender）：
 * - 缩放围绕视口中心：屏幕中心对应的世界点 midPoint = scroll + viewport/2，
 *   与 zoom 无关；
 * - 可见世界区域 worldView = midPoint ± viewport/(2·zoom)。
 *
 * 因此所有边界 clamp 以「相机中心（世界坐标）」为锚点计算，
 * scroll = center − viewport/2 只作为 Phaser 写入的换算。
 */

/**
 * 水平方向：相机中心的世界 X 只能落在
 * [visibleWidth/2, worldWidth − visibleWidth/2]；
 * 若可见宽度比 World 更宽（极端情况），水平居中整个 World。
 */
export function clampCameraCenterX(
  centerX: number,
  visibleWorldWidth: number,
  worldWidth: number
): number {
  if (visibleWorldWidth >= worldWidth) {
    return worldWidth / 2;
  }
  const min = visibleWorldWidth / 2;
  const max = worldWidth - visibleWorldWidth / 2;
  return Math.min(max, Math.max(min, centerX));
}

/**
 * 垂直方向：贴地构图 —— 可见区域底边对齐 World 底部（地面所在区域）。
 * - 可见高度不足 World：centerY = worldHeight − visibleHeight/2
 * - 可见高度 ≥ World：垂直居中
 */
export function groundAnchoredCenterY(
  visibleWorldHeight: number,
  worldHeight: number
): number {
  if (visibleWorldHeight >= worldHeight) {
    return worldHeight / 2;
  }
  return worldHeight - visibleWorldHeight / 2;
}
