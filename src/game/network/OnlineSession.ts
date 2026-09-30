import type { NetworkTransport } from './NetworkTransport';
import type { NetworkManager } from './NetworkManager';
import type { PeerRole } from './PeerRole';
import type { SignalingClient } from './signaling/SignalingClient';
import type { PlayerId } from '../state/ids';

/**
 * Phase 14：跨 Scene 容器 key（main.ts 组合根 → game.registry 注入
 * OnlineSessionManager 实例；各 Scene 经 this.registry 读取）。
 * 归属链：OnlineConnectionScene（VERIFIED 产出）→ registry → BattleScene
 * 接管 —— 不挂任何单一 Scene 生命周期（Scene 切换不销毁连接）。
 */
export const ONLINE_SESSION_MANAGER_KEY = 'onlineSessionManager';

/**
 * OnlineSession（Phase 13）—— 已验证的联机会话。
 *
 * 归属链：OnlineConnectionController（VERIFIED 产出）→ OnlineSessionManager
 * 持有（Phase 14 起经 game.registry 跨 Scene 共享）—— **不挂在任何 Scene
 * 生命周期上**（Scene 切换不销毁连接）；回菜单 / Game Over 退出时
 * disposeSession 彻底关闭。
 *
 * Host = P1 / Guest = P2 固定（Phase 13 不做角色选择，Future 可扩展）。
 */
export interface OnlineSession {
  readonly role: PeerRole;
  readonly localPlayerId: PlayerId;
  readonly remotePlayerId: PlayerId;
  /** 显式携带：disposeSession 需要关闭底层连接（NetworkManager.dispose 只 close transport，
   * 但为防 Manager 未包住的自定义 transport，双保险显式持有） */
  readonly transport: NetworkTransport;
  readonly networkManager: NetworkManager;
  /**
   * SG-3（Room 流专属；Manual debug 流为 undefined）：房间信令客户端。
   * 对局期间保持连接 —— 房间存活 + peerToken 即 SG-8 ICE restart 的重信令
   * 通道（玩家无需重输房间码）；生命周期由 SessionManager dispose 链收口。
   */
  signaling?: SignalingClient;
  /**
   * SG-8（Room 流专属；Manual debug 流为 undefined）：对局期连接恢复上下文。
   * BattleScene 据此组装 RoomRecoveryController（限次 ICE restart + 重信令）；
   * 缺失 = 不可恢复（Manual 流沿用即时 OPPONENT DISCONNECTED 旧 UX）。
   */
  readonly recovery?: {
    readonly roomCode: string;
    readonly peerToken: string;
  };
}

/**
 * OnlineSessionManager —— 会话持有者（普通类，Scene/Boot 层持有实例，
 * **禁止模块级 singleton**）。
 *
 * 生命周期 = Online Match：连接成功后跨 Scene 存活；disposeSession 彻底销毁。
 */
export class OnlineSessionManager {
  private session: OnlineSession | null = null;

  get current(): OnlineSession | null {
    return this.session;
  }

  /** 存储会话；覆盖旧会话前先彻底销毁（防泄漏旧连接） */
  store(session: OnlineSession): void {
    if (this.session !== null) {
      console.warn('[OnlineSessionManager] replacing existing session — disposing previous');
      this.disposeSession();
    }
    this.session = session;
  }

  /** 接管重建信令；旧 Scene / 已退出的会话不能复活连接。 */
  replaceSignaling(session: OnlineSession, signaling: SignalingClient): boolean {
    if (this.session !== session) {
      return false;
    }
    const previous = session.signaling;
    session.signaling = signaling;
    if (previous !== signaling) {
      previous?.close();
    }
    return true;
  }

  /** 彻底销毁：manager 退订 + transport close + signaling close；幂等 */
  disposeSession(): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    this.session = null;
    session.networkManager.dispose();
    session.transport.close();
    session.signaling?.close();
  }
}
