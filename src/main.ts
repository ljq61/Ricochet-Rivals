import Phaser from 'phaser';
import { createPhaserGameConfig } from './game/config/PhaserGameConfig';
import { OrientationGate } from './game/platform/OrientationGate';
import { ONLINE_SESSION_MANAGER_KEY, OnlineSessionManager } from './game/network/OnlineSession';
import { AudioUnlock } from './game/audio/AudioUnlock';

const root = document.getElementById('game-root');
if (!root) {
  throw new Error('#game-root element not found in index.html');
}

const game = new Phaser.Game(createPhaserGameConfig(root));
const audioUnlock = new AudioUnlock(game.sound);
game.events.once(Phaser.Core.Events.DESTROY, () => audioUnlock.destroy());

// Phase 14：联机会话持有者注入 game.registry（跨 Scene 容器 ——
// Scene 之间共享同一实例，Scene 切换不销毁连接；禁止模块级 singleton，
// 归属链见 OnlineSession.ts 注释）。OnlineConnectionScene VERIFIED 时
// store，BattleScene 接管消费，退出对局 / 回菜单时 disposeSession。
game.registry.set(ONLINE_SESSION_MANAGER_KEY, new OnlineSessionManager());

// Phase 6.5 Mobile：竖屏门禁（触屏设备竖屏时显示旋转提示，
// 覆盖层同时拦截 InputRouter 的指针手势 —— pointerdown 只认 canvas）。
// Phase 13：仅 Battle 强制横屏 —— Menu / Online Connection 等连接流程
// 允许竖屏（手机复制 / 粘贴连接码时竖屏体验更佳）
new OrientationGate(document, () => game.scene.isActive('BattleScene'));

// iOS Safari 的捏合 / 双击缩放兜底（touch-action 已在 CSS 层处理，
// 这里拦截非标准 gesture 事件，防止 Safari 忽略 user-scalable=no）
for (const eventName of ['gesturestart', 'gesturechange', 'gestureend'] as const) {
  document.addEventListener(eventName, (event) => event.preventDefault());
}
document.addEventListener('dblclick', (event) => event.preventDefault());
// 长按 / 右键不弹浏览器菜单（触屏长按同样产生 contextmenu；
// 桌面右键是取消瞄准的游戏操作）
document.addEventListener('contextmenu', (event) => event.preventDefault());
