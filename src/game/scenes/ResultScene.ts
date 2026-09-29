import Phaser from 'phaser';
import { playerColor, toCssColor } from '../config/Palette';
import { DEBUG_GAME } from '../config/DebugConfig';
import type { MatchSetup } from '../match/MatchSetup';
import { createMatchSetup } from '../match/MatchFactory';
import { ViewportService } from '../platform/ViewportService';
import { InputRouter } from '../input/InputRouter';
import { MenuButton, type ButtonRect } from '../ui/MenuButton';
import type { PlayerId } from '../state/ids';
import {
  ONLINE_SESSION_MANAGER_KEY,
  type OnlineSession,
  type OnlineSessionManager,
} from '../network/OnlineSession';
import { OnlineGameCoordinator } from '../network/online/OnlineGameCoordinator';
import type {
  OnlineBattleBootstrap,
  OnlineGameCoordinatorApi,
  OnlineLobbyHandlers,
} from '../network/online/OnlineTypes';
import type { PeerRole } from '../network/PeerRole';
import { BattleScene } from './BattleScene';
import { MainMenuScene } from './MainMenuScene';

const TITLE_FONT = 46;

/** ResultScene 入参（BattleScene gameOver 转场时注入） */
export interface ResultSceneData {
  setup: MatchSetup;
  winnerId: PlayerId | null;
  /** Phase 14 联机：本地玩家 ID（YOU WIN / YOU LOSE 视角）；离线不传 */
  localPlayerId?: PlayerId;
  /**
   * Phase 16 联机：对局协调器（随转场交接）。ResultScene 负责 dispose；
   * session / transport 保留在 registry SessionManager 供 Rematch 复用。
   */
  onlineCoordinator?: OnlineGameCoordinatorApi;
}

/**
 * 结果场景（Phase 11 基础版；Phase 14 起支持 Online；Phase 16 Online Rematch）：
 * - Single Player：YOU WIN / YOU LOSE（P1 视角）
 * - Local 2P：PLAYER 1 WINS / PLAYER 2 WINS；平局（同归于尽）→ DRAW
 * - Online（Phase 14）：本地视角 YOU WIN / YOU LOSE
 * - REMATCH（离线）：同一 MatchSetup 重新 scene.start(BattleScene) ——
 *   create 重建全新 GameState，旧局污染随场景重建一并清除
 * - REMATCH（联机，Phase 16）：复用同一 WebRTC session（不重连）——
 *   新 OnlineGameCoordinator 走 PLAYER_READY → Host 汇齐 → 新 GAME_START
 *   （新 matchId + seed）→ 双方进全新对局；显示"对方已准备"；对端在
 *   Result 期离开（断线）→ 提示只能回菜单
 */
export class ResultScene extends Phaser.Scene {
  static readonly KEY = 'ResultScene';

  private setup!: MatchSetup;
  private winnerId!: PlayerId | null;
  /** Phase 14 联机本地视角（离线 null） */
  private localPlayerId: PlayerId | null = null;
  /** Phase 16：交接来的旧局协调器（SHUTDOWN 时 dispose） */
  private oldCoordinator: OnlineGameCoordinatorApi | null = null;
  /** Phase 16：Rematch 握手协调器（点击 REMATCH 后创建；复用同一 session） */
  private rematchCoordinator: OnlineGameCoordinator | null = null;
  private rematchCancel: (() => void) | null = null;
  private rematchPhase: 'idle' | 'waiting' | 'opponent-left' = 'idle';
  private viewport!: ViewportService;
  private inputRouter!: InputRouter;
  private titleText!: Phaser.GameObjects.Text;
  private statusLine!: Phaser.GameObjects.Text;
  private rematchButton: MenuButton | null = null;
  private mainMenuButton!: MenuButton;
  private transitioning = false;

  constructor() {
    super(ResultScene.KEY);
  }

  init(data: ResultSceneData): void {
    this.setup = data.setup;
    this.winnerId = data.winnerId;
    this.localPlayerId = data.localPlayerId ?? null;
    this.oldCoordinator = data.onlineCoordinator ?? null;
    // 场景实例复用防御（Phase 11 教训）：残留状态必须显式复位
    this.rematchCoordinator = null;
    this.rematchCancel = null;
    this.rematchPhase = 'idle';
    this.transitioning = false;
  }

  create(): void {
    this.viewport = new ViewportService(this, { worldCameraZoom: false });
    this.inputRouter = new InputRouter(this);
    this.cameras.main.fadeIn(220, 0, 0, 0);

    this.titleText = this.add
      .text(0, 0, this.resultLabel(), {
        fontFamily: 'monospace',
        color: this.resultColor(),
      })
      .setOrigin(0.5)
      .setDepth(900);
    this.statusLine = this.add
      .text(0, 0, '', { fontFamily: 'monospace', color: '#8fa3c7' })
      .setOrigin(0.5)
      .setDepth(900);

    if (this.setup.mode !== 'online') {
      this.rematchButton = new MenuButton(this, {
        router: this.inputRouter,
        id: 'result-rematch',
        viewport: this.viewport,
        label: 'REMATCH',
        onTap: () => this.transitionTo(BattleScene.KEY, { setup: this.setup }),
      });
    } else {
      // Phase 16：Online Rematch —— 复用 session 的新握手（点击后发送
      // PLAYER_READY；Host 汇齐双 Ready 生成新 GAME_START）
      this.rematchButton = new MenuButton(this, {
        router: this.inputRouter,
        id: 'result-rematch',
        viewport: this.viewport,
        label: 'REMATCH',
        onTap: () => this.onOnlineRematch(),
      });
    }
    this.mainMenuButton = new MenuButton(this, {
      router: this.inputRouter,
      id: 'result-main-menu',
      viewport: this.viewport,
      label: 'MAIN MENU',
      accent: 0x56698a,
      onTap: () => this.transitionTo(MainMenuScene.KEY),
    });

    this.reposition();
    this.viewport.onChange(() => this.reposition());
    this.installDebugHandles();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // ---- Phase 16：Online Rematch -----------------------------------------

  private onOnlineRematch(): void {
    if (this.transitioning || this.rematchCoordinator !== null) {
      return;
    }
    const sessionManager = this.registry.get(ONLINE_SESSION_MANAGER_KEY) as
      | OnlineSessionManager
      | undefined;
    const session: OnlineSession | null = sessionManager?.current ?? null;
    if (session === null || !session.transport.connected) {
      // 对端早已离开：session 被本地销毁（null），或对端 Result 期退出
      // —— 旧协调器 gameOver 抑制了断线提示，session 残留但通道已死
      // （connected=false）。继续 sendPlayerReady 会向死通道发送抛
      // TransportError（未捕获 = 按钮无响应无提示）—— 直接给 OPPONENT LEFT
      this.rematchPhase = 'opponent-left';
      this.refreshRematchStatus();
      return;
    }
    // 旧局协调器使命完成（其订阅 / 保活 / barrier 状态全部作废）
    this.oldCoordinator?.dispose();
    this.oldCoordinator = null;
    // 新协调器复用同一 session：WebRTC 连接不重建；channel / sync 状态
    // 随新实例天然重置；Host 的 createMatchIdentity 生成全新 matchId+seed
    this.rematchCoordinator = new OnlineGameCoordinator({
      session,
      createMatchIdentity: this.makeRematchIdentity(),
    });
    const handlers: OnlineLobbyHandlers = {
      onStart: (bootstrap) => this.startRematchBattle(bootstrap),
      onDisconnected: () => {
        this.rematchPhase = 'opponent-left';
        this.refreshRematchStatus();
      },
    };
    this.rematchCancel = this.rematchCoordinator.enterLobby(handlers);
    this.rematchCoordinator.sendPlayerReady();
    this.rematchPhase = 'waiting';
    this.refreshRematchStatus();
  }

  /**
   * Rematch 对局身份：沿用 OnlineConnectionScene 同款生成（对局 setup
   * 随机不属于 Gameplay RNG —— CODELY.md §16 管局内随机）。
   */
  private makeRematchIdentity(): () => { matchId: string; seed: number } {
    return () => ({
      matchId: `match-${Date.now().toString(36)}-${Math.floor(
        Math.random() * 1e9,
      ).toString(36)}`,
      seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0,
    });
  }

  /** 双方 Ready → 新 GAME_START → 全新对局（新 matchId / seed / GameState） */
  private startRematchBattle(bootstrap: OnlineBattleBootstrap): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    this.rematchCancel?.();
    this.rematchCancel = null;
    this.scene.start(BattleScene.KEY, {
      setup: createMatchSetup('online', bootstrap.role as PeerRole),
      online: bootstrap,
    });
  }

  /** Rematch 状态行 + 按钮可用性（等待 / 对方已准备 / 对方已离开） */
  private refreshRematchStatus(): void {
    const el = this.rematchCoordinator;
    if (this.rematchPhase === 'opponent-left') {
      this.statusLine.setText('OPPONENT LEFT — BACK TO MENU');
      this.rematchButton?.setVisible(false);
      return;
    }
    if (el !== null && el.opponentReady) {
      this.statusLine.setText('OPPONENT READY — WAITING FOR GAME…');
      return;
    }
    this.statusLine.setText('WAITING FOR OPPONENT…');
  }

  update(_time: number, _delta: number): void {
    // 对端 Ready 到达是事件驱动 —— 轮询刷新提示行（无 rAF 依赖的
    // 消息处理在此页可能后台化，回到前台补一次渲染）
    if (this.rematchPhase === 'waiting' && this.rematchCoordinator?.opponentReady) {
      this.refreshRematchStatus();
    }
  }

  private transitionTo(key: string, data?: Record<string, unknown>): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    // 回菜单 / 离线 rematch：联机资源彻底清理（Rematch 握手取消 +
    // session 销毁 → transport CLOSED，对端经断线提示得知）
    this.rematchCancel?.();
    this.rematchCancel = null;
    if (this.setup.mode === 'online') {
      // 未点 REMATCH 直接回菜单：旧局协调器同样要收口 —— 其 Battle 期
      // startKeepAlive 的 interval 只经 dispose 清理，漏掉即孤儿 timer
      this.oldCoordinator?.dispose();
      this.oldCoordinator = null;
      this.rematchCoordinator?.dispose();
      this.rematchCoordinator = null;
      const sessionManager = this.registry.get(ONLINE_SESSION_MANAGER_KEY) as
        | OnlineSessionManager
        | undefined;
      sessionManager?.disposeSession();
    }
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => {
        this.scene.start(key, data);
      }
    );
  }

  private resultLabel(): string {
    if (this.winnerId === null) {
      return 'DRAW';
    }
    if (this.setup.mode === 'single_player') {
      return this.winnerId === 'P1' ? 'YOU WIN' : 'YOU LOSE';
    }
    if (this.setup.mode === 'online') {
      // Phase 14：本地视角（P1=Host / P2=Guest，经 localPlayerId 判断）
      return this.winnerId === this.localPlayerId ? 'YOU WIN' : 'YOU LOSE';
    }
    return this.winnerId === 'P1' ? 'PLAYER 1 WINS' : 'PLAYER 2 WINS';
  }

  private resultColor(): string {
    if (this.winnerId === null) {
      return '#ffd24a';
    }
    if (
      this.setup.mode === 'single_player' ||
      this.setup.mode === 'online'
    ) {
      const won =
        this.setup.mode === 'online'
          ? this.winnerId === this.localPlayerId
          : this.winnerId === 'P1';
      return won ? '#3f8cff' : '#ff5063';
    }
    return toCssColor(playerColor(this.winnerId));
  }

  private reposition(): void {
    const { width, height, uiScale } = this.viewport.current;

    this.titleText.setFontSize(TITLE_FONT * uiScale);
    this.titleText.setPosition(width / 2, height * 0.34);
    this.statusLine.setFontSize(16 * uiScale);
    this.statusLine.setPosition(width / 2, height * 0.46);

    const buttonH = 64 * uiScale;
    const gap = MODE_GAP * uiScale;
    const baseY = height * 0.56;
    if (this.rematchButton) {
      this.rematchButton.setPosition(width / 2, baseY);
      this.mainMenuButton.setPosition(width / 2, baseY + buttonH + gap);
    } else {
      this.mainMenuButton.setPosition(width / 2, baseY);
    }
  }

  private installDebugHandles(): void {
    if (!DEBUG_GAME) {
      return;
    }
    const self = this;
    (window as unknown as Record<string, unknown>).__RR_DEBUG__ = {
      get scene(): string {
        return 'ResultScene';
      },
      get resultText(): string {
        return self.titleText.text;
      },
      get winnerId(): string | null {
        return self.winnerId;
      },
      /** Phase 16：Rematch 握手状态（E2E 断言） */
      get rematchPhase(): string {
        return self.rematchPhase;
      },
      /** Phase 16：transitioning 守卫状态（卡点诊断） */
      get busy(): boolean {
        return self.transitioning;
      },
      get opponentReady(): boolean {
        return self.rematchCoordinator?.opponentReady ?? false;
      },
      /** Phase 16：Rematch 协调器握手详情（selfReady/started/netState） */
      get rematchInfo(): object | null {
        return self.rematchCoordinator !== null ? self.rematchCoordinator.debugInfo() : null;
      },
      get buttons(): Record<string, ButtonRect> {
        const ui = self.viewport.current.uiScale;
        const toCss = (button: MenuButton): ButtonRect => {
          const r = button.rect();
          return {
            x: r.x / ui,
            y: r.y / ui,
            width: r.width / ui,
            height: r.height / ui,
          };
        };
        const rects: Record<string, ButtonRect> = {
          mainMenu: toCss(self.mainMenuButton),
        };
        if (self.rematchButton) {
          rects.rematch = toCss(self.rematchButton);
        }
        return rects;
      },
    };
  }

  private onShutdown(): void {
    // Phase 16：未交接出去的协调器在此收口（startRematchBattle 已把
    // rematch coordinator 经 bootstrap 交给 BattleScene —— Battle 的
    // onShutdown 按既定生命周期处置，此处禁止二次 dispose）
    if (this.transitioning) {
      // 已显式 transitionTo 清理 / 或已交接给 Battle
      this.viewport.destroy();
      this.inputRouter.destroy();
      return;
    }
    this.rematchCancel?.();
    this.rematchCancel = null;
    this.oldCoordinator?.dispose();
    this.oldCoordinator = null;
    this.rematchCoordinator?.dispose();
    this.rematchCoordinator = null;
    const sessionManager = this.registry.get(ONLINE_SESSION_MANAGER_KEY) as
      | OnlineSessionManager
      | undefined;
    sessionManager?.disposeSession();
    this.viewport.destroy();
    this.inputRouter.destroy();
  }
}

const MODE_GAP = 20;
