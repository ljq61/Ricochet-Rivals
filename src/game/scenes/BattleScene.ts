import Phaser from 'phaser';
import { createInitialGameState, TurnPhase, type GameState } from '../state/GameState';
import type { PlayerId } from '../state/ids';
import { CameraMode } from '../camera/CameraMode';
import { CameraController } from '../camera/CameraController';
import { InMemoryCommandBus, type CommandBus } from '../commands/CommandBus';
import { GameLogic } from '../systems/GameLogic';
import { MovementSystem } from '../systems/MovementSystem';
import { FireSystem } from '../systems/FireSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { ConcreteDamageSystem } from '../systems/DamageSystem';
import { ExplosionSystem } from '../systems/ExplosionSystem';
import { TurnManager } from '../systems/TurnManager';
import { WorldBuilder } from '../systems/WorldBuilder';
import { Player } from '../entities/Player';
import { detectDeviceProfile, type DeviceProfile } from '../platform/DeviceProfile';
import { ViewportService } from '../platform/ViewportService';
import { InputRouter } from '../input/InputRouter';
import type { InputSource } from '../input/InputSource';
import { DesktopControls } from '../input/DesktopControls';
import { TouchControls } from '../input/TouchControls';
import { AIInputSource } from '../ai/AIInputSource';
import { SeededRandom } from '../random/SeededRandom';
import { createMatchSetup } from '../match/MatchFactory';
import type { BattleSceneData, MatchSetup } from '../match/MatchSetup';
import { AimController } from '../input/AimController';
import { AimButton } from '../ui/AimButton';
import { AimRenderer } from '../ui/AimRenderer';
import { PlayerHud } from '../ui/PlayerHud';
import { TurnBanner } from '../ui/TurnBanner';
import { DamageNumbers } from '../ui/DamageNumbers';
import { DebugOverlay } from '../ui/DebugOverlay';
import { ResultScene, type ResultSceneData } from './ResultScene';
import { DEBUG_GAME } from '../config/DebugConfig';

/**
 * 战斗场景（CODELY.md §3）。
 *
 * BattleScene 只负责：
 * - Scene 生命周期
 * - 系统初始化
 * - 系统连接
 * - update 调度
 *
 * Phase 6.5 平台架构（CODELY.md §25）：
 * DeviceProfile（pointer/hover 能力，不用 UA）决定 Control Profile；
 * Desktop / Touch 只是两个 Input Adapter 门面（DesktopControls /
 * TouchControls），共享同一套：
 *   GameState / GameCommand / MovementSystem / Aim 计算 / ProjectileSystem
 * 指针手势统一由 InputRouter 仲裁（UI > AIM > MOVEMENT > CAMERA，
 * 一个 Pointer 一个 Owner）；ViewportService 提供动态 zoom
 * （纵向构图稳定）与 Safe Area；World = 5000×1080 恒定。
 *
 * Phase 7 伤害链路：
 * impact 事件 → ExplosionSystem（ExplosionEvent → DamageSystem →
 * DamageResult → GameState）→ 反馈（相机抖动 / 伤害数字 /
 * 受击闪烁 / HP HUD 动画）。Projectile 不直接修改 Player HP。
 *
 * Phase 8 回合状态机（TurnManager，纯逻辑）：
 * ACTION → RETURN_HOME → AIM → PROJECTILE → RESOLVE → END（切换玩家
 * + turnId++ + 重置预算）→ 相机 TURN_TRANSITION → 下一回合 ACTION；
 * 致死 → GAME_OVER（不切换）。相机模式 ↔ TurnPhase 由本场景在
 * 事件点回调 + update() 对账同步；输入层跟随当前回合玩家（热座）。
 *
 * Phase 11 对局启动（MatchSetup 注入）：
 * scene.start(KEY, { setup }) → init(data) 保存 MatchSetup；本场景
 * 只凭 setup.p2Controller 决定 InputSource 组合（SP → P2 =
 * AIInputSource），禁止从 URL / 全局变量猜模式。缺 setup 兜底
 * local_2p（不抛错）。
 */
export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'BattleScene';

  /** Phase 11：MatchSetup（init 注入，缺省 local_2p 兜底） */
  private setup!: MatchSetup;
  private state!: GameState;
  private commandBus!: CommandBus;
  private gameLogic!: GameLogic;
  private projectileSystem!: ProjectileSystem;
  private explosionSystem!: ExplosionSystem;
  private turnManager!: TurnManager;
  private deviceProfile!: DeviceProfile;
  private viewportService!: ViewportService;
  private inputRouter!: InputRouter;
  private controls!: InputSource;
  /** SP（setup.p2Controller === 'ai'）：P2 的 AI 输入源；其余模式 null */
  private aiInput: AIInputSource | null = null;
  private touchControls: TouchControls | null = null;
  private aimController!: AimController;
  private playerViews!: Record<PlayerId, Player>;
  private cameraController!: CameraController;
  private aimButton!: AimButton;
  private aimRenderer!: AimRenderer;
  private playerHud!: PlayerHud;
  private turnBanner!: TurnBanner;
  private damageNumbers!: DamageNumbers;
  private debugOverlay!: DebugOverlay;
  /** Phase 9 横幅状态检测（同 PlayerHud displayedHp 模式：State 唯一数据源） */
  private bannerTurnKey: string | null = null;
  private bannerGameOverShown = false;

  constructor() {
    super(BattleScene.KEY);
  }

  /**
   * Phase 11 Scene 启动注入：scene.start(KEY, { setup }) 的数据在
   * init 阶段到达。缺省兜底 local_2p（健壮降级，不抛错），直接启动
   * BattleScene（BootScene / 调试）不会因缺 setup 崩溃。
   */
  init(data: BattleSceneData): void {
    this.setup = data?.setup ?? createMatchSetup('local_2p');
    // scene.start 复用 Scene 实例：类字段初始化只在构造时执行一次，
    // 对局级字段必须全部在此复位（旧实例资源已在 onShutdown destroy，
    // 这里只清引用）。逐字段审视结论（create 是否每局无条件重建）：
    // - 无条件重建（安全，不复位）：state / commandBus / gameLogic /
    //   projectileSystem / explosionSystem / turnManager / playerViews /
    //   deviceProfile / viewportService / inputRouter / cameraController /
    //   aimButton / controls（touch / desktop 两分支必走其一）/
    //   aimController / aimRenderer / playerHud / turnBanner / damageNumbers /
    //   debugOverlay；setup 由 init 本身无条件赋值（带兜底）
    // - 条件赋值（必须复位）：
    //   aiInput —— 仅 SP（p2Controller === 'ai'）分支赋值；SP 完赛后
    //   转 local_2p 时旧实例残留非 null（destroy 只 reset 内部状态，闭包
    //   经 getState/commandBus 指向新局 state/bus），幽灵 AI 接管 P2
    //   回合并禁用人类输入（C1）
    //   touchControls —— 仅 touch 分支赋值；同会话 profile 不变理论安全，
    //   为防 profile 漂移一并复位（一行成本消除整类隐患）
    //   bannerTurnKey / bannerGameOverShown —— 横幅去重 / 转场单次守卫状态
    this.aiInput = null;
    this.touchControls = null;
    this.bannerTurnKey = null;
    this.bannerGameOverShown = false;
  }

  create(): void {
    // 1. 逻辑状态（纯数据，不持有 Phaser 对象）
    this.state = createInitialGameState({
      matchId: `${this.setup.mode}-match`,
      seed: 1,
    });

    // 2. 静态世界
    new WorldBuilder(this).build();

    // 3. 玩家视觉实体（渲染层，从 State 同步）
    this.playerViews = {
      P1: new Player(this, this.state.players.P1),
      P2: new Player(this, this.state.players.P2),
    };

    // 4. 系统初始化：CommandBus → GameLogic → Systems
    this.projectileSystem = new ProjectileSystem(this);
    this.commandBus = new InMemoryCommandBus();
    this.gameLogic = new GameLogic(this.state, this.commandBus, {
      movement: new MovementSystem(),
      fire: new FireSystem(),
      projectile: this.projectileSystem,
    });
    // Phase 7：爆炸结算链（Projectile 不直接改 HP）
    this.explosionSystem = new ExplosionSystem({
      damage: new ConcreteDamageSystem(),
    });

    // Phase 8：回合状态机（startMatch → P1 ACTION，重置预算 / hasFired）
    this.turnManager = new TurnManager(this.state);
    this.turnManager.startMatch();

    // 5. 平台档案 + 视口服务（动态 zoom，必须在相机初始定位前应用）
    this.deviceProfile = detectDeviceProfile();
    this.viewportService = new ViewportService(this);

    // 6. 指针手势路由（UI > AIM > MOVEMENT > CAMERA，一个 Pointer 一个 Owner）
    this.inputRouter = new InputRouter(this);

    // 7. Camera 状态机（中心锚定 + zoom 感知；拖动走 InputRouter）
    this.cameraController = new CameraController(this);
    this.viewportService.onChange(() =>
      this.cameraController.onViewportChanged()
    );
    this.inputRouter.registerClaimant(this.cameraController);
    this.cameraController.setMode(CameraMode.FREE_VIEW);
    const firstPlayer = this.state.players[this.state.currentPlayerId];
    this.cameraController.centerOnX(firstPlayer.x);

    // 8. HUD：瞄准入口按钮（触屏档位加大；AIMING 时点击 = 取消）
    const isTouch = this.deviceProfile.controlProfile === 'touch';
    this.aimButton = new AimButton(this, {
      router: this.inputRouter,
      viewport: this.viewportService,
      isTouchProfile: isTouch,
      onTap: () => this.onAimButtonTap(),
    });

    // 9. 平台控制门面：共享 MoveInputCore / 规则系统，仅输入采集不同；
    //    控制目标 = 当前回合玩家（Phase 8 热座）
    if (isTouch) {
      this.touchControls = new TouchControls(this, {
        getState: () => this.state,
        commandBus: this.commandBus,
        router: this.inputRouter,
        viewport: this.viewportService,
        onFocusSelf: () =>
          this.cameraController.panToX(
            this.state.players[this.state.currentPlayerId].x
          ),
        onFocusEnemy: () => {
          const enemyId: PlayerId =
            this.state.currentPlayerId === 'P1' ? 'P2' : 'P1';
          this.cameraController.panToX(this.state.players[enemyId].x);
        },
        getCameraMode: () => this.cameraController.currentMode,
      });
      this.controls = this.touchControls;
    } else {
      this.controls = new DesktopControls(this, {
        getState: () => this.state,
        commandBus: this.commandBus,
        hotkeys: {
          onAimRequest: () => this.requestAim(),
          onAimCancel: () => this.cancelAim(),
        },
      });
    }

    // 9.5 Phase 11 MatchSetup 注入：P2 控制者由 setup 决定
    //     （createMatchSetup('single_player') → p2Controller === 'ai'）；
    //     local_2p / online 本块不执行，热座行为与 Phase 9 完全一致。
    //     相机 / 横幅 / HUD 零改动 —— AI 的 FIRE 走 onLaunched 事件链
    //     自动 PROJECTILE_FOLLOW，回合切换走现有 TURN_TRANSITION。
    //     随机源从对局 seed 派生（CODELY.md §16）。
    if (this.setup.p2Controller === 'ai') {
      this.aiInput = new AIInputSource({
        playerId: 'P2',
        getState: () => this.state,
        commandBus: this.commandBus,
        rng: new SeededRandom(this.state.seed),
        difficulty: this.setup.aiDifficulty ?? 'normal',
      });
    }

    // 10. 瞄准输入与渲染（AIM claimant，桌面 / 触屏共用计算）
    this.aimController = new AimController(this, {
      getState: () => this.state,
      getCameraMode: () => this.cameraController.currentMode,
      commandBus: this.commandBus,
      isTouchProfile: isTouch,
      getUiScale: () => this.viewportService.current.uiScale,
    });
    this.inputRouter.registerClaimant(this.aimController);
    this.aimRenderer = new AimRenderer(this);

    // 11. 相机 ↔ 投射物事件连接（Phase 6/7/8）：
    //     发射 → PROJECTILE 相位 + 相机跟随；
    //     碰撞 → 伤害结算 → RESOLVE 相位 → 反馈 → 锁定爆炸点停留；
    //     停留结束 / 出界 → 回合收口（endTurn / TURN_TRANSITION / GAME_OVER）
    this.projectileSystem.onLaunched(() => {
      this.turnManager.notifyProjectileLaunched();
      this.cameraController.followProjectile(() => {
        const projectile = this.projectileSystem.activeProjectiles[0];
        return projectile ? { x: projectile.x, y: projectile.y } : null;
      });
    });
    this.projectileSystem.onImpact((impact) => {
      // Phase 7：ExplosionEvent → DamageSystem → DamageResult → GameState，
      // 再驱动反馈（相机抖动 / 伤害数字 / 受击闪烁 / HP HUD 动画）
      const result = this.explosionSystem.explode(this.state, impact);
      this.turnManager.notifyProjectileResolved(result);
      this.cameraController.shake();
      this.damageNumbers.show(result, this.state.players);
      for (const entry of result.players) {
        if (entry.damage > 0) {
          this.playerViews[entry.playerId].playHitReaction();
        }
      }
      void this.cameraController
        .focusImpact({ x: impact.x, y: impact.y })
        .then(() => this.onAttackResolved());
    });
    this.projectileSystem.onOutOfBounds(() => {
      // 出界：无爆炸无伤害，同样进入 RESOLVE 并收口回合
      this.turnManager.notifyProjectileResolved(null);
      this.onAttackResolved();
    });

    // 12. HUD：HP 血条（伤害动画由 State 变化驱动）+ 回合横幅（Phase 9 热座）
    this.playerHud = new PlayerHud(this, this.viewportService);
    this.turnBanner = new TurnBanner(this, this.viewportService);
    this.damageNumbers = new DamageNumbers(this, this.viewportService);

    // 13. Debug Overlay + E2E 观测句柄
    this.debugOverlay = new DebugOverlay(this);
    this.installDebugHandles();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  update(_time: number, delta: number): void {
    // Phase 10 SP：按回合归属接线（AI 回合静默人类输入）。
    // 必须先于 controls.update —— 热座 playerId 跟随 currentPlayerId，
    // 接线晚一帧会让回合切换瞬间的人类按键被路由给 AI 玩家。
    this.syncInputOwnership();

    // 输入 → 命令 → 规则（先更新逻辑，再同步视觉）
    this.controls.update(delta);
    this.aiInput?.update(delta);
    this.aimController.update();

    // 炮弹物理推进 + 碰撞/出界/超时判定
    this.projectileSystem.update(this.state, delta);

    // 视觉同步：State 是唯一数据源
    this.playerViews.P1.update(this.state.players.P1, delta);
    this.playerViews.P2.update(this.state.players.P2, delta);

    this.cameraController.update(delta);
    this.aimRenderer.update(this.aimController.aimState);
    this.aimButton.refresh(this.cameraController.currentMode);
    this.touchControls?.refresh(this.cameraController.currentMode);
    this.playerHud.refresh(this.state.players);

    // Phase 9：回合横幅 —— 新回合进入 ACTION 时短暂提示轮到谁
    // （开场与每次 TURN_TRANSITION 完成后各触发一次；取消瞄准回到
    // ACTION 不换 key，不重复弹横幅）。游戏结束改由胜负横幅接管。
    const turnKey = `${this.state.currentPlayerId}:${this.state.turnId}`;
    if (
      this.bannerTurnKey !== turnKey &&
      this.state.phase === TurnPhase.ACTION
    ) {
      this.bannerTurnKey = turnKey;
      this.turnBanner.showTurn(this.state.currentPlayerId, this.state.turnId);
    }
    if (!this.bannerGameOverShown && this.state.gameOver) {
      this.bannerGameOverShown = true;
      this.turnBanner.showGameOver(this.state.winnerId);
      // Phase 11：胜负横幅停留 ~1.6s → 淡出 → ResultScene。
      // delayedCall 绑定本场景时钟，shutdown 自动清理（无跨场景泄漏）；
      // 单次守卫由 bannerGameOverShown 保证。
      this.time.delayedCall(1600, () => this.transitionToResult());
    }
    // 对账同步：相机已进入 AIMING 而 phase 还在 RETURN_HOME → AIM
    // （相机 Tween 完成是异步的，由唯一入口 requestAim 保证方向正确）
    if (
      this.state.phase === TurnPhase.RETURN_HOME &&
      this.cameraController.currentMode === CameraMode.AIMING
    ) {
      this.turnManager.notifyAimingStarted();
    }
    this.debugOverlay.refresh({
      fps: this.game.loop.actualFps,
      cameraX: this.cameraController.scrollX,
      currentPlayerId: this.state.currentPlayerId,
      turnId: this.state.turnId,
      cameraMode: this.cameraController.currentMode,
      controlProfile: this.deviceProfile.controlProfile,
      cameraZoom: this.cameras.main.zoom,
      orientation: this.viewportService.current.orientation,
      phase: this.state.phase,
      canvasCssWidth: this.game.canvas.clientWidth,
      canvasCssHeight: this.game.canvas.clientHeight,
      gameWidth: this.cameras.main.width,
      gameHeight: this.cameras.main.height,
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      uiScale: this.viewportService.current.uiScale,
    });
  }

  /** 瞄准按钮点击：AIMING → 取消；其余 → 发起瞄准 */
  private onAimButtonTap(): void {
    if (this.cameraController.currentMode === CameraMode.AIMING) {
      this.cancelAim();
      return;
    }
    this.requestAim();
  }

  /** Phase 11：对局结束 → 结果场景（转场 150～300ms） */
  private transitionToResult(): void {
    this.cameras.main.fadeOut(250, 26, 34, 51);
    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => {
        this.scene.start(ResultScene.KEY, {
          setup: this.setup,
          winnerId: this.state.winnerId,
        } satisfies ResultSceneData);
      }
    );
  }

  /** 发起瞄准：TurnManager 相位门禁通过后驱动相机流程 */
  private requestAim(): void {
    if (this.isAiControlledTurn()) {
      return; // SP：AI 回合内人类瞄准入口（Space / AimButton）全部静默
    }
    if (!this.turnManager.requestAim()) {
      return;
    }
    this.cameraController.requestAim(
      () => this.state.players[this.state.currentPlayerId].x
    );
  }

  /** 取消瞄准：相位与相机各自回退 */
  private cancelAim(): void {
    if (this.isAiControlledTurn()) {
      return; // SP：AI 回合内 Esc / 右键不得打断 AI 攻击的相机流程
    }
    this.turnManager.cancelAim();
    this.cameraController.cancelAim();
  }

  /** SP：当前回合是否由 AI 控制（Local 2P 恒 false） */
  private isAiControlledTurn(): boolean {
    return (
      this.aiInput !== null &&
      this.state.currentPlayerId === this.aiInput.playerId
    );
  }

  /** SP：回合归属切换人类 / AI 输入（gameOver 后人类恢复自由观察） */
  private syncInputOwnership(): void {
    if (!this.aiInput) {
      return;
    }
    const aiTurn =
      this.state.currentPlayerId === this.aiInput.playerId &&
      !this.state.gameOver;
    this.controls.setEnabled(!aiTurn);
    this.aiInput.setEnabled(aiTurn);
  }

  /**
   * 一次攻击结束（爆炸停留完成 / 出界）。
   * Phase 8：RESOLVE → END（切换玩家 + turnId++ + 重置预算）→
   * 相机 TURN_TRANSITION 到新玩家 → 下一回合 ACTION。
   * 游戏结束：相位停留 GAME_OVER，相机回自由观察，不再切换。
   */
  private onAttackResolved(): void {
    const mode = this.cameraController.currentMode;
    if (mode !== CameraMode.IMPACT && mode !== CameraMode.PROJECTILE_FOLLOW) {
      return;
    }
    if (this.state.gameOver) {
      this.cameraController.enableFreeView();
      return;
    }
    this.turnManager.endTurn();
    void this.cameraController
      .transitionToPlayer(
        () => this.state.players[this.state.currentPlayerId].x
      )
      .then(() => this.turnManager.notifyTurnTransitionComplete());
  }

  /**
   * E2E / 手动调试观测句柄（DEBUG_GAME 才安装）。
   * 只读快照，避免测试依赖私有字段。
   */
  private installDebugHandles(): void {
    if (!DEBUG_GAME) {
      return;
    }
    const self = this;
    (window as unknown as Record<string, unknown>).__RR_DEBUG__ = {
      get scene(): string {
        return 'BattleScene';
      },
      get controlProfile(): string {
        return self.deviceProfile.controlProfile;
      },
      get cameraMode(): string {
        return self.cameraController.currentMode;
      },
      get cameraScrollX(): number {
        return self.cameraController.scrollX;
      },
      get cameraScrollY(): number {
        return self.cameras.main.scrollY;
      },
      get cameraZoom(): number {
        return self.cameras.main.zoom;
      },
      get uiScale(): number {
        return self.viewportService.current.uiScale;
      },
      get orientation(): string {
        return self.viewportService.current.orientation;
      },
      get currentPlayerId(): string {
        return self.state.currentPlayerId;
      },
      get turnId(): number {
        return self.state.turnId;
      },
      get hasFired(): boolean {
        return self.state.players[self.state.currentPlayerId].hasFired;
      },
      get projectileCount(): number {
        return self.projectileSystem.activeProjectiles.length;
      },
      get players(): { P1: number; P2: number } {
        return {
          P1: self.state.players.P1.x,
          P2: self.state.players.P2.x,
        };
      },
      get hp(): { P1: number; P2: number } {
        return {
          P1: self.state.players.P1.hp,
          P2: self.state.players.P2.hp,
        };
      },
      get phase(): string {
        return self.state.phase;
      },
      get gameOver(): boolean {
        return self.state.gameOver;
      },
      /** Phase 10+11：P2 由 AI 控制（MatchSetup.p2Controller === 'ai'） */
      get aiEnabled(): boolean {
        return self.aiInput !== null;
      },
      get winnerId(): string | null {
        return self.state.winnerId;
      },
      get turnBanner(): { visible: boolean; text: string } {
        return {
          visible: self.turnBanner.visible,
          text: self.turnBanner.text,
        };
      },
      /** 最近一次横幅文本（fade 后保留，E2E 时序无关断言用） */
      get lastBannerText(): string {
        return self.turnBanner.lastBannerText;
      },
      /** ◀ / ▶ 触屏移动按钮可见性（Phase 9 瞄准锁定；桌面无按钮 = null） */
      get moveButtonsVisible(): boolean | null {
        return self.touchControls
          ? self.touchControls.isMoveButtonsVisible
          : null;
      },
      /** E2E 注入用（仅 DEBUG_GAME）：构造击杀场景，不经过 DamageSystem */
      setHp(playerId: string, hp: number): void {
        const player = self.state.players[playerId as PlayerId];
        player.hp = hp;
        player.isAlive = hp > 0;
      },
    };
  }

  private onShutdown(): void {
    this.viewportService.destroy();
    this.inputRouter.destroy();
    this.cameraController.destroy();
    this.gameLogic.destroy();
    this.controls.destroy();
    this.aiInput?.destroy();
    this.aimController.destroy();
    this.aimButton.destroy();
    this.aimRenderer.destroy();
    this.playerHud.destroy();
    this.turnBanner.destroy();
    this.projectileSystem.destroy();
  }
}
