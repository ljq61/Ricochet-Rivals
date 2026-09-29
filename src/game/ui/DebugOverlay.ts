import Phaser from 'phaser';
import { DEBUG_GAME, DEBUG_NETWORK } from '../config/DebugConfig';
import type { CameraMode } from '../camera/CameraMode';
import type { ControlProfile } from '../platform/DeviceProfile';
import type { Orientation } from '../platform/ViewportService';
import type { PlayerId } from '../state/ids';
import type { TurnPhase } from '../state/TurnPhase';
import type { OnlineDebugInfo } from '../network/online/OnlineTypes';

export interface DebugSnapshot {
  fps: number;
  cameraX: number;
  currentPlayerId: PlayerId;
  turnId: number;
  cameraMode: CameraMode;
  controlProfile: ControlProfile;
  cameraZoom: number;
  orientation: Orientation;
  /** Phase 8：回合阶段 */
  phase: TurnPhase;
  /** 真机诊断：画布 CSS 尺寸 / 游戏尺寸 / DPR / 视口尺寸 / UI 缩放 */
  canvasCssWidth: number;
  canvasCssHeight: number;
  gameWidth: number;
  gameHeight: number;
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  uiScale: number;
  /** Phase 14 联机：DEBUG_NETWORK 时展示（离线 null = 不显示） */
  online?: OnlineDebugInfo | null;
}

/**
 * 开发阶段 Debug Overlay（左上角固定）：
 * FPS / Camera X / Current Player / Turn ID / Camera Mode
 * + Phase 6.5：Control Profile / Camera Zoom / Orientation
 * + Phase 8：TurnPhase
 * + 真机诊断行：Canvas CSS 尺寸 / Game 尺寸 / window 视口。
 * 高分屏清晰渲染下：Game = Canvas × DPR = VP × DPR ——
 * 数字不满足该关系即布局错位根源。
 * 由 DebugConfig.DEBUG_GAME 控制是否创建；
 * 真机修复：字号经 uiScale（= DPR）换算。
 */
export class DebugOverlay {
  private label: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene) {
    if (!DEBUG_GAME) {
      return;
    }
    const ui = Math.max(1, window.devicePixelRatio || 1);
    // 触屏设备整体 ×0.5：DPR 3 手机上 15px×3 字号 + 诊断行实测遮挡近半
    // 屏（真机反馈）；桌面鼠标档位保持原尺寸。按 pointer capability 判定
    //（与 DeviceProfile 同哲学，不用 User Agent）。
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const debugUi = coarse ? ui * 0.5 : ui;
    this.label = scene.add
      .text(16 * debugUi, 16 * debugUi, '', {
        fontFamily: 'monospace',
        fontSize: `${15 * debugUi}px`,
        color: '#8fe3a0',
        backgroundColor: 'rgba(10, 14, 22, 0.65)',
        padding: { x: 10 * debugUi, y: 8 * debugUi },
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

  refresh(snapshot: DebugSnapshot): void {
    if (!this.label) {
      return;
    }
    const fps = snapshot.fps.toFixed(0).padStart(3, ' ');
    const camX = snapshot.cameraX.toFixed(0).padStart(5, ' ');
    const zoom = snapshot.cameraZoom.toFixed(2);
    const lines = [
      `FPS      ${fps}`,
      `Camera X ${camX}`,
      `Player   ${snapshot.currentPlayerId}`,
      `Turn     ${snapshot.turnId}`,
      `Cam Mode ${snapshot.cameraMode}`,
      `Profile  ${snapshot.controlProfile} (${snapshot.orientation})`,
      `Zoom     ${zoom}`,
      `Phase    ${snapshot.phase}`,
      `Canvas   ${snapshot.canvasCssWidth}x${snapshot.canvasCssHeight}`,
      `Game     ${snapshot.gameWidth}x${snapshot.gameHeight} @${snapshot.devicePixelRatio}x`,
      `VP       ${snapshot.viewportWidth}x${snapshot.viewportHeight}`,
      `UIScale  ${snapshot.uiScale}`,
    ];
    // Phase 14：NETWORK 段（ROLE / LOCAL / REMOTE / MATCH / NET STATE /
    // LAST RX / LAST TX / PING）—— 离线对局无 online 快照则不显示
    if (DEBUG_NETWORK && snapshot.online) {
      const net = snapshot.online;
      const ping = net.pingMs === null ? '…' : `${net.pingMs.toFixed(0)}ms`;
      lines.push(
        `Net      ${net.role} ${net.netState} ${ping}`,
        `Local    ${net.localPlayerId} vs ${net.remotePlayerId}`,
        `Match    ${net.matchId ?? '…'} rx=${net.lastRxType ?? '…'} tx=${net.lastTxType ?? '…'}`,
      );
      // Phase 15：SYNC 段（STATE / RECOVERY / REASON / HASH 双端对比）
      const syncState = net.syncState ?? '—';
      const recovery = net.recoveryCount ?? 0;
      const reason = net.lastSyncReason ?? '—';
      const localH = net.localHash ?? '…';
      const hostH = net.hostHash ?? '…';
      const hashMatch = net.localHash !== null && net.localHash === net.hostHash;
      lines.push(
        `Sync     ${syncState} recover=${recovery}`,
        `Reason   ${reason}`,
        `Hash     ${localH} / ${hostH}${hashMatch ? ' =' : ' ≠'}`,
      );
    }
    this.label.setText(lines.join('\n'));
  }
}
