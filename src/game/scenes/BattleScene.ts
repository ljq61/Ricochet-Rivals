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
import { BaseDamageEffects } from '../systems/BaseDamageEffects';
import { OctopusTentacle } from '../systems/OctopusTentacle';
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
import { SfxBus, SFX, type SfxKey } from '../audio/SfxBus';
import { PlayerHud } from '../ui/PlayerHud';
import { TurnBanner } from '../ui/TurnBanner';
import { DamageNumbers } from '../ui/DamageNumbers';
import { DebugOverlay } from '../ui/DebugOverlay';
import { ResultScene, type ResultSceneData } from './ResultScene';
import { MainMenuScene } from './MainMenuScene';
import { DEBUG_GAME, DEBUG_NETWORK } from '../config/DebugConfig';
import { MenuButton } from '../ui/MenuButton';
import { stateFromSnapshot } from '../network/online/AuthoritativeState';
import { OnlineSyncState } from '../network/online/sync/OnlineSyncState';
import type {
  CommandRejectedPayload,
  OnlineBattleBootstrap,
  OnlineGameCoordinatorApi,
} from '../network/online/OnlineTypes';
import {
  ONLINE_SESSION_MANAGER_KEY,
  type OnlineSessionManager,
} from '../network/OnlineSession';

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
  /** Phase 17 Juice：音效总线（发射/飞行/爆炸/命中/回合/胜负） */
  private sfx!: SfxBus;
  private playerHud!: PlayerHud;
  private turnBanner!: TurnBanner;
  private damageNumbers!: DamageNumbers;
  /** Phase 17 Juice：基地受损表现（烟/火随 HP 分档，State 驱动纯视觉） */
  private baseDamageEffects!: BaseDamageEffects;
  /** Phase 17 玩法特性：中央章鱼触手（任一方 HP ≤ 4 升起，阻挡中低弹道） */
  private octopusTentacle!: OctopusTentacle;
  private debugOverlay!: DebugOverlay;
  /** Phase 9 横幅状态检测（同 PlayerHud displayedHp 模式：State 唯一数据源） */
  private bannerTurnKey: string | null = null;
  private bannerGameOverShown = false;
  // ---- Phase 14 联机（离线全部 null —— 零网络依赖） ----
  /** 协调器（bootstrap 注入；BattleScene 只经 OnlineGameCoordinatorApi 交互） */
  private online: OnlineGameCoordinatorApi | null = null;
  private onlineBootstrap: OnlineBattleBootstrap | null = null;
  /** 通道中断冻结（OPPONENT DISCONNECTED 后禁输入） */
  private connectionLost = false;
  /** Phase 15：Guest desync 恢复期间输入锁（coordinator setSyncLock 驱动） */
  private syncLocked = false;
  /** Phase 15：SYNC_FAILED 终局（onSyncFailure 后禁重复处理） */
  private syncFailed = false;
  /** Phase 16：联机对局已交接给 ResultScene（SHUTDOWN 不销毁 session） */
  private handedToResult = false;
  /** 断线后的返回菜单按钮（懒创建） */
  private disconnectButton: MenuButton | null = null;
  /** COMMAND_REJECTED 轻量提示防刷屏 */
  private lastRejectedToastMs = 0;
  /** 相机/回合流事件环形日志（E2E 排查 aim/transition 时序用） */
  private readonly cameraEventLog: string[] = [];

  constructor() {
    super(BattleScene.KEY);
  }

  /**
   * Phase 11 Scene 启动注入：scene.start(KEY, { setup }) 的数据在
   * init 阶段到达。缺省兜底 local_2p（健壮降级，不抛错），直接启动
   * BattleScene（BootScene / 调试）不会因缺 setup 崩溃。
   */
  init(data: BattleSceneData & { online?: OnlineBattleBootstrap }): void {
    this.setup = data?.setup ?? createMatchSetup('local_2p');
    this.onlineBootstrap = data?.online ?? null;
    this.online = this.onlineBootstrap?.coordinator ?? null;
    // scene.start 复用 Scene 实例：类字段初始化只在构造时执行一次，
    // 对局级字段必须全部在此复位（旧实例资源已在 onShutdown destroy，
    // 这里只清引用）。逐字段审视结论（create 是否每局无条件重建）：
    // - 无条件重建（安全，不复位）：state / commandBus / gameLogic /
    //   projectileSystem / explosionSystem / turnManager / playerViews /
    //   deviceProfile / viewportService / inputRouter / cameraController /
    //   aimButton / controls（touch / desktop 两分支必走其一）/
    //   aimController / aimRenderer / playerHud / turnBanner / damageNumbers /
    //   debugOverlay；setup / onlineBootstrap / online 由 init 本身无条件
    //   赋值（带兜底，联机局结束后转离线 = null 天然复位）
    // - 条件赋值（必须复位）：
    //   aiInput —— 仅 SP（p2Controller === 'ai'）分支赋值；SP 完赛后
    //   转 local_2p 时旧实例残留非 null（destroy 只 reset 内部状态，闭包
    //   经 getState/commandBus 指向新局 state/bus），幽灵 AI 接管 P2
    //   回合并禁用人类输入（C1）
    //   touchControls —— 仅 touch 分支赋值；同会话 profile 不变理论安全，
    //   为防 profile 漂移一并复位（一行成本消除整类隐患）
    //   bannerTurnKey / bannerGameOverShown —— 横幅去重 / 转场单次守卫状态
    //   disconnectButton / connectionLost / lastRejectedToastMs —— Phase 14
    //   联机专属条件状态（联机局结束后转离线必须清）
    this.aiInput = null;
    this.touchControls = null;
    this.bannerTurnKey = null;
    this.bannerGameOverShown = false;
    this.connectionLost = false;
    this.syncLocked = false;
    this.syncFailed = false;
    this.handedToResult = false;
    this.disconnectButton = null;
    this.lastRejectedToastMs = 0;
  }

  create(): void {
    // 1. 逻辑状态（纯数据，不持有 Phaser 对象）。
    //    Phase 14 联机：从 GAME_START 权威快照重建（双方同源，Guest 禁止
    //    自产 seed / 位置 / 首位玩家）；离线：本地初始状态。
    this.state =
      this.onlineBootstrap !== null
        ? stateFromSnapshot(this.onlineBootstrap.gameStart.initialState)
        : createInitialGameState({
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

    // Phase 17 Juice：基地受损表现（HP 越低烟/火越重；create 无条件重建，
    // scene 复用安全 —— Phase 11 init/create 复位清单约定）
    this.baseDamageEffects = new BaseDamageEffects(this);

    // Phase 17 玩法特性：中央章鱼触手（任一方 HP ≤ 4 升起；create 无条件重建）
    this.octopusTentacle = new OctopusTentacle(this);

    // 4. 系统初始化：CommandBus → GameLogic → Systems
    this.projectileSystem = new ProjectileSystem(this);
    this.commandBus = new InMemoryCommandBus();
    this.gameLogic = new GameLogic(this.state, this.commandBus, {
      movement: new MovementSystem(),
      fire: new FireSystem(),
      projectile: this.projectileSystem,
    });
    // Phase 8：回合状态机（startMatch → P1 ACTION，重置预算 / hasFired）
    this.turnManager = new TurnManager(this.state);
    // Phase 14：联机协调器 attach（必须先于爆炸系统 / 输入源接线 ——
    // damageSystem 与 inputBus 均由协调器提供）。Host 的本地输入与
    // Guest 请求走同一条 Bus → GameLogic → Systems 权威路径；Guest 的
    // inputBus 为意图拦截（*_REQUEST），本地不执行。
    if (this.online !== null) {
      this.online.attach({
        getState: () => this.state,
        commandBus: this.commandBus,
        gameLogic: this.gameLogic,
        turnManager: this.turnManager,
        // Phase 15 双语义：Guest = TURN_END 已由 channel 应用
        //（applyRemoteTurnEnd），只做相机转场收尾；Host = ACK 后到补驱
        //（dwell 曾返回 waiting），TURN_END 已由 channel 发出，本地权威
        // endTurn 仍归场景 —— 与 'proceed' 返回值路径等价收尾。
        resumeNextTurn: () => {
          if (this.online?.role === 'host') {
            this.turnManager.endTurn();
          }
          this.beginNextTurnTransition();
        },
        showAuthoritativeDamage: (result) =>
          this.damageNumbers.show(result, this.state.players),
        showRejected: (payload) => this.showOnlineRejected(payload),
        onDisconnected: () => this.handleOnlineDisconnected(),
        // Phase 15：Guest 恢复期间锁 Move/Aim/Fire（复用远程回合输入锁口径，
        // syncLocked 并入 isRemoteControlledTurn —— 相机自由观察保留）
        setSyncLock: (locked) => {
          this.syncLocked = locked;
        },
        onSyncStateChange: (state, detail) => {
          this.handleOnlineSyncStateChange(state, detail);
        },
        onSyncFailure: () => {
          this.handleOnlineSyncFailure();
        },
      });
      this.online.startKeepAlive();
    }
    // Phase 7：爆炸结算链（Projectile 不直接改 HP）。
    // 联机 Guest 注入 calculate-only 伤害系统 —— 本地 HP 只经
    // TURN_RESULT reconcile 改写（Host 权威）。
    this.explosionSystem = new ExplosionSystem({
      damage:
        this.online !== null
          ? this.online.damageSystem
          : new ConcreteDamageSystem(),
    });
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
    //    控制目标 = 当前回合玩家（Phase 8 热座）。
    //    Phase 14 联机：输入总线换协调器 inputBus（Host = 真实执行总线，
    //    广播由 outcome 钩子负责；Guest = 意图拦截 → *_REQUEST）
    const inputBus: CommandBus =
      this.online !== null ? this.online.inputBus : this.commandBus;
    if (isTouch) {
      this.touchControls = new TouchControls(this, {
        getState: () => this.state,
        commandBus: inputBus,
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
        commandBus: inputBus,
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

    // 10. 瞄准输入与渲染（AIM claimant，桌面 / 触屏共用计算；
    //     Phase 14 联机：FIRE 意图同样进协调器 inputBus）
    this.aimController = new AimController(this, {
      getState: () => this.state,
      getCameraMode: () => this.cameraController.currentMode,
      commandBus: inputBus,
      isTouchProfile: isTouch,
      getUiScale: () => this.viewportService.current.uiScale,
    });
    this.inputRouter.registerClaimant(this.aimController);
    this.aimRenderer = new AimRenderer(this);
    // Phase 17 Juice：音效总线（事件驱动，规则层零感知）
    this.sfx = new SfxBus(this);

    // 11. 相机 ↔ 投射物事件连接（Phase 6/7/8）：
    //     发射 → PROJECTILE 相位 + 相机跟随；
    //     碰撞 → 伤害结算 → RESOLVE 相位 → 反馈 → 锁定爆炸点停留；
    //     停留结束 / 出界 → 回合收口（endTurn / TURN_TRANSITION / GAME_OVER）
    this.projectileSystem.onLaunched((projectile) => {
      this.playerViews[projectile.ownerId].playFireReaction();
      this.logCameraEvent(`launched`);
      // Phase 17 Juice：发射音 + 飞行口哨各播一次（真机反馈：口哨循环
      // 在 desync 清场路径下停不掉且听感重复 —— 单次播放，无循环句柄）
      this.sfx.play(SFX.launch);
      this.sfx.play(SFX.projectile);
      this.turnManager.notifyProjectileLaunched();
      this.cameraController.followProjectile(() => {
        const projectile = this.projectileSystem.activeProjectiles[0];
        return projectile ? { x: projectile.x, y: projectile.y } : null;
      });
    });
    this.projectileSystem.onImpact((impact) => {
      this.logCameraEvent(`impact@${Math.round(impact.x)}`);
      // Phase 7：ExplosionEvent → DamageSystem → DamageResult → GameState，
      // 再驱动反馈（相机抖动 / 伤害数字 / 受击闪烁 / HP HUD 动画）
      const result = this.explosionSystem.explode(this.state, impact);
      this.turnManager.notifyProjectileResolved(result);
      this.cameraController.shake();
      // Phase 17 Juice：爆炸；有命中再加 hit 反馈音
      this.sfx.play(SFX.explosion);
      if (result.players.some((entry) => entry.damage > 0)) {
        this.sfx.play(SFX.hit);
      }
      for (const entry of result.players) {
        if (entry.damage > 0) {
          this.playerViews[entry.playerId].playHitReaction();
        }
      }
      // Phase 14：Host 广播权威 TURN_RESULT；Guest 记录本地结算
      this.online?.notifyTurnResolved(impact, result);
      // 伤害数字：Host / 离线 = 本地结算即权威，立即展示；
      // Guest = 等 TURN_RESULT（showAuthoritativeDamage 用 Host 数值，
      // 不展示本地预测 —— 避免先弹 2 再改 1 的双跳）
      if (this.online === null || this.online.role === 'host') {
        this.damageNumbers.show(result, this.state.players);
      }
      void this.cameraController
        .focusImpact({ x: impact.x, y: impact.y })
        .then(() => this.onAttackResolved());
    });
    this.projectileSystem.onOutOfBounds(() => {
      this.logCameraEvent('outOfBounds');
      // 出界：无爆炸无伤害，同样进入 RESOLVE 并收口回合
      this.turnManager.notifyProjectileResolved(null);
      this.online?.notifyTurnResolved(null, null);
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
    // Phase 17 修复轮：瞄准时角色朝向跟随发射方向（抛物线反向拖拽）+
    // 抬枪姿态序列（15–75°）；瞄准结束 / 发射后由本方法自动复位 idle
    this.updateAimPoseVisual();
    // Phase 14：联机对手回合隐藏瞄准 / 移动按钮（相机 Free View 仍可用）
    const localControls = this.isLocalControlledTurn();
    this.aimButton.refresh(this.cameraController.currentMode, localControls);
    this.touchControls?.refresh(this.cameraController.currentMode, localControls);
    this.playerHud.refresh(this.state.players);
    this.baseDamageEffects.refresh(this.state.players);
    this.octopusTentacle.refresh(this.state.players);

    // Phase 9：回合横幅 —— 新回合进入 ACTION 时短暂提示轮到谁
    // （开场与每次 TURN_TRANSITION 完成后各触发一次；取消瞄准回到
    // ACTION 不换 key，不重复弹横幅）。游戏结束改由胜负横幅接管。
    // Phase 14 联机：本地视角 YOUR TURN / OPPONENT'S TURN。
    const turnKey = `${this.state.currentPlayerId}:${this.state.turnId}`;
    if (
      this.bannerTurnKey !== turnKey &&
      this.state.phase === TurnPhase.ACTION
    ) {
      this.bannerTurnKey = turnKey;
      // 断线 / 同步失败后不再弹回合横幅 —— 迟到的转场 showTurn 会
      // 覆盖 OPPONENT DISCONNECTED / SYNC FAILED 提示（E2E 实测 flaky
      // 25% 暴露；横幅是玩家对局状态感知的唯一来源，覆盖即误导）
      if (!this.connectionLost && !this.syncFailed) {
        this.sfx.play(SFX.turn);
        if (this.online !== null) {
          const label =
            this.state.currentPlayerId === this.online.localPlayerId
              ? `YOUR TURN · 第 ${this.state.turnId} 回合`
              : `OPPONENT'S TURN · 第 ${this.state.turnId} 回合`;
          this.turnBanner.showTurn(this.state.currentPlayerId, this.state.turnId, label);
        } else {
          this.turnBanner.showTurn(this.state.currentPlayerId, this.state.turnId);
        }
      }
    }
    if (!this.bannerGameOverShown && this.state.gameOver) {
      // Phase 15：Guest 终局 hash 门 —— 未确认前不收口（避免双端胜负
      // 显示不一致；确认路径：gameOver TURN_RESULT hash 匹配或快照恢复）
      if (this.online !== null && this.online.role === 'guest' && !this.online.isFinalStateConfirmed()) {
        return;
      }
      this.bannerGameOverShown = true;
      this.sfx.play(this.gameOverJingleKey());
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
      // Phase 18 性能观测：全场景存活粒子数（真机 QA / E2E 粒子预算）
      particles: DEBUG_GAME ? this.countAliveParticles() : 0,
      // Phase 14：DEBUG_NETWORK 段（离线 null = 不显示）
      online:
        this.online !== null && DEBUG_NETWORK ? this.online.debugInfo() : null,
    });
  }

  /** Phase 18 性能观测：所有 ParticleEmitter 的存活粒子计数总和 */
  private countAliveParticles(): number {
    let count = 0;
    for (const child of this.children.list) {
      if (child instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
        count += child.getAliveParticleCount();
      }
    }
    return count;
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
        // Phase 16：联机对局把旧协调器交接给 ResultScene（其 dispose 归
        // Result；session / transport 保留在 registry SessionManager，
        // Rematch 复用同一 WebRTC 连接）。handedToResult 置位后
        // SHUTDOWN 不销毁 session（见 onShutdown）。
        this.handedToResult = this.online !== null;
        this.scene.start(ResultScene.KEY, {
          setup: this.setup,
          winnerId: this.state.winnerId,
          localPlayerId: this.online?.localPlayerId,
          onlineCoordinator: this.handedToResult
            ? (this.online as OnlineGameCoordinatorApi)
            : undefined,
        } satisfies ResultSceneData);
      }
    );
  }

  /** 发起瞄准：TurnManager 相位门禁通过后驱动相机流程 */
  private requestAim(): void {
    if (this.isAiControlledTurn()) {
      return; // SP：AI 回合内人类瞄准入口（Space / AimButton）全部静默
    }
    if (this.isRemoteControlledTurn()) {
      return; // Phase 14：对手回合 / 断线后瞄准入口全部静默
    }
    if (!this.turnManager.requestAim()) {
      return;
    }
    // Phase 17 真机反馈轮：瞄准激活 = 上弹音（按钮 / Space 统一入口，
    // 守卫全过后才响 —— no-op 点击不播）
    this.sfx.play(SFX.load);
    this.logCameraEvent(`requestAim→cam=${this.cameraController.currentMode}`);
    this.cameraController.requestAim(
      () => this.state.players[this.state.currentPlayerId].x
    );
  }

  /** 取消瞄准：相位与相机各自回退 */
  private cancelAim(): void {
    if (this.isAiControlledTurn() || this.isRemoteControlledTurn()) {
      return; // SP：AI 回合内 Esc / 右键不得打断 AI 攻击的相机流程
    }
    this.logCameraEvent(`cancelAim→cam=${this.cameraController.currentMode}`);
    this.turnManager.cancelAim();
    this.cameraController.cancelAim();
  }

  /** E2E / 手动诊断：相机流事件环形日志（最近 30 条） */
  private logCameraEvent(event: string): void {
    this.cameraEventLog.push(`${this.state.turnId}:${event}`);
    if (this.cameraEventLog.length > 30) {
      this.cameraEventLog.shift();
    }
  }

  /** SP：当前回合是否由 AI 控制（Local 2P 恒 false） */
  private isAiControlledTurn(): boolean {
    return (
      this.aiInput !== null &&
      this.state.currentPlayerId === this.aiInput.playerId
    );
  }

  /**
   * Phase 17 修复轮：瞄准姿态 / 朝向驱动。aimState.active 时按发射方向
   * （-normalize(drag)，即抛物线初速方向）翻转朝向，仰角分桶切换抬枪
   * 序列图（15–75°）；非激活（取消 / 发射 / 相机离开 AIMING / 回合
   * 切换后 currentPlayer 恒 idle）复位 idle。仅动渲染层，零规则耦合。
   */
  private updateAimPoseVisual(): void {
    const aim = this.aimController.aimState;
    const view = this.playerViews[this.state.currentPlayerId];
    if (!aim.active) {
      view.setAimPose(null);
      return;
    }
    view.setFacing(aim.directionX >= 0 ? 1 : -1);
    const elevation =
      (Math.atan2(Math.abs(aim.directionY), Math.abs(aim.directionX)) * 180) / Math.PI;
    view.setAimPose(elevation);
  }

  /**
   * Phase 14：当前回合是否不可由本地输入发起动作（对手回合或已断线）。
   * 离线恒 false。移动 / 瞄准入口据此静默；相机 Free View 不受影响
   * （对方回合仍可观察战场，CODELY.md Phase 14 规约）。
   */
  private isRemoteControlledTurn(): boolean {
    return (
      this.connectionLost ||
      this.syncLocked || // Phase 15：desync 恢复期间锁 Move/Aim/Fire
      (this.online !== null && !this.online.isLocalTurn())
    );
  }

  /** Phase 14：本地输入源是否可交互（按钮可见性 / 输入锁共用口径） */
  private isLocalControlledTurn(): boolean {
    return !this.isRemoteControlledTurn();
  }

  /** SP：回合归属切换人类 / AI 输入（gameOver 后人类恢复自由观察） */
  private syncInputOwnership(): void {
    if (this.aiInput) {
      const aiTurn =
        this.state.currentPlayerId === this.aiInput.playerId &&
        !this.state.gameOver;
      this.controls.setEnabled(!aiTurn);
      this.aiInput.setEnabled(aiTurn);
      return;
    }
    if (this.online !== null) {
      // Phase 14：仅本地玩家回合启用本地输入（Move/Aim/Fire）；
      // 对手回合期间相机 Free View 仍可自由观察
      this.controls.setEnabled(this.isLocalControlledTurn());
      return;
    }
    // Local 2P 热座：恒启用（系统层按回合归属校验）
  }

  /**
   * 一次攻击结束（爆炸停留完成 / 出界）。
   * Phase 8：RESOLVE → END（切换玩家 + turnId++ + 重置预算）→
   * 相机 TURN_TRANSITION 到新玩家 → 下一回合 ACTION。
   * 游戏结束：相位停留 GAME_OVER，相机回自由观察，不再切换。
   * Phase 14 联机：Turn Barrier —— Host 在此发 TURN_END（本地权威
   * endTurn）；Guest 'waiting' 时挂起（TURN_END 到达且本地 dwell 完成
   * 后经 resumeNextTurn 补驱），回合切换始终由 Host 控制。
   */
  private onAttackResolved(): void {
    const mode = this.cameraController.currentMode;
    if (mode !== CameraMode.IMPACT && mode !== CameraMode.PROJECTILE_FOLLOW) {
      this.logCameraEvent(`attackResolved-guarded(cam=${mode})`);
      return;
    }
    if (this.state.gameOver) {
      this.logCameraEvent('attackResolved-gameOver');
      this.cameraController.enableFreeView();
      return;
    }
    if (this.online !== null) {
      const decision = this.online.onLocalAttackResolved();
      this.logCameraEvent(`attackResolved-${decision}`);
      if (decision === 'waiting') {
        return; // Guest：TURN_END 未到 —— resumeNextTurn 回调补驱转场
      }
      if (this.online.role === 'host') {
        this.turnManager.endTurn(); // Host 本地权威推进
        this.beginNextTurnTransition();
        return;
      }
      // guest 'proceed'：applyRemoteTurnEnd 已在协调器内驱动
      // resumeNextTurn → 转场已启动 —— 场景严禁重复发起（二次发起会把
      // 首个 transition tween 提前 resolve，相机滞留 TURN_TRANSITION，
      // 后续 requestAim 被 aimFlow 静默拒绝 —— P2P E2E 实测）
      return;
    }
    this.turnManager.endTurn();
    this.beginNextTurnTransition();
  }

  /**
   * Phase 17 Juice：胜负 jingle（本地视角）—— 联机/单机按本机胜负；
   * Local 2P 任一方获胜都在本机庆祝；同归于尽按 defeat 收场。
   */
  private gameOverJingleKey(): SfxKey {
    const winner = this.state.winnerId;
    if (winner === null) {
      return SFX.defeat;
    }
    if (this.online !== null) {
      return winner === this.online.localPlayerId ? SFX.victory : SFX.defeat;
    }
    if (this.setup.mode === 'single_player') {
      return winner === 'P1' ? SFX.victory : SFX.defeat;
    }
    return SFX.victory;
  }

  /** 相机 TURN_TRANSITION 到新玩家 → ACTION（Host/离线/Guest 共用收尾） */
  private beginNextTurnTransition(): void {
    this.logCameraEvent(
      `beginTransition→cam=${this.cameraController.currentMode}`
    );
    void this.cameraController
      .transitionToPlayer(
        () => this.state.players[this.state.currentPlayerId].x
      )
      .then(() => this.turnManager.notifyTurnTransitionComplete());
  }

  // ---- Phase 14 联机表现层 ----------------------------------------------

  /**
   * COMMAND_REJECTED 轻量提示（Guest）。状态本就从未本地执行 ——
   * 无需回滚；2s 防刷屏（移动键连按可能触发一串拒绝）。
   */
  private showOnlineRejected(payload: CommandRejectedPayload): void {
    const now = Date.now();
    if (now - this.lastRejectedToastMs < 2_000) {
      return;
    }
    this.lastRejectedToastMs = now;
    this.turnBanner.showMessage(`ACTION REJECTED — ${payload.reason}`, 0xffd24a);
  }

  /**
   * 通道中断：冻结输入 + 持久横幅 + 返回菜单入口（无重连 ——
   * 复杂 reconnect 属 Phase 15+；对局结束后的正常关闭已被协调器抑制）。
   */
  private handleOnlineDisconnected(): void {
    if (this.connectionLost) {
      return;
    }
    this.connectionLost = true;
    this.controls.setEnabled(false);
    this.turnBanner.showMessage('OPPONENT DISCONNECTED', 0xff5063);
    if (this.disconnectButton === null) {
      this.disconnectButton = new MenuButton(this, {
        router: this.inputRouter,
        id: 'battle-back-to-menu',
        viewport: this.viewportService,
        label: 'BACK TO MENU',
        onTap: () => this.leaveToMainMenu(),
      });
      const { width, height } = this.viewportService.current;
      this.disconnectButton.setPosition(width / 2, height * 0.62);
    }
  }

  /** Phase 15：同步状态迁移展示（DESYNC/SYNCING 提示；SYNCED 类不打扰） */
  private handleOnlineSyncStateChange(state: OnlineSyncState, detail?: string): void {
    if (state === OnlineSyncState.DESYNC_DETECTED || state === OnlineSyncState.SYNC_REQUESTED) {
      // Phase 15 修复轮：进入恢复即废弃在飞本地模拟 —— 权威快照将整回合
      // 重述；后台冻结的炮弹迟发 impact 会把相机打回 IMPACT 且无重试
      // 路径 → 永久滞留（E2E 全量复现：cam=IMPACT 而 phase=ACTION）
      this.projectileSystem.clearInFlightSimulations();
      this.turnBanner.showMessage('SYNCHRONIZING…', 0xffc24d);
    } else if (state === OnlineSyncState.SYNC_FAILED) {
      this.handleOnlineSyncFailure();
    }
    // SYNCED / APPLYING_SNAPSHOT / SYNCED_AFTER_RECOVERY：无横幅
    // （恢复期通常亚秒级，横幅闪烁比静默更伤体验）；诊断走 DebugOverlay
    if (DEBUG_NETWORK && detail !== undefined) {
      this.logCameraEvent(`sync=${state}:${detail}`);
    }
  }

  /** Phase 15：同步彻底失败（重试耗尽）—— 终止比赛回菜单，禁止继续错局 */
  private handleOnlineSyncFailure(): void {
    if (this.syncFailed || this.connectionLost) {
      return;
    }
    this.syncFailed = true;
    this.syncLocked = true;
    this.controls.setEnabled(false);
    this.turnBanner.showMessage('CONNECTION SYNC FAILED', 0xff5063);
    if (this.disconnectButton === null) {
      this.disconnectButton = new MenuButton(this, {
        router: this.inputRouter,
        id: 'battle-back-to-menu',
        viewport: this.viewportService,
        label: 'BACK TO MENU',
        onTap: () => this.leaveToMainMenu(),
      });
      const { width, height } = this.viewportService.current;
      this.disconnectButton.setPosition(width / 2, height * 0.62);
    }
  }

  /** 断线 / 退出返回主菜单（fade + rAF 冻结兜底，幂等） */
  private leaveToMainMenu(): void {
    let started = false;
    const startMenu = (): void => {
      if (started) {
        return;
      }
      started = true;
      this.scene.start(MainMenuScene.KEY);
    };
    this.cameras.main.fadeOut(220, 26, 34, 51);
    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      startMenu
    );
    this.time.delayedCall(300, startMenu);
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
      /** Phase 17 Juice：基地受损档位（0=完好…4=大火大烟；E2E/调试观测口） */
      get baseDamageTier(): { P1: number; P2: number } {
        return {
          P1: self.baseDamageEffects.tierOf('P1'),
          P2: self.baseDamageEffects.tierOf('P2'),
        };
      },
      /** Read-only rendered frames for animation QA (including nested player images). */
      get artAnimation(): object[] {
        const objects = self.children.list.flatMap((item) =>
          item instanceof Phaser.GameObjects.Container ? item.list : [item]);
        return objects.filter((item): item is Phaser.GameObjects.Image | Phaser.GameObjects.Sprite =>
          item instanceof Phaser.GameObjects.Image || item instanceof Phaser.GameObjects.Sprite)
          .filter((item) => /art-(blue|red|base-fire|octopus)/.test(item.texture.key))
          .map((item) => ({ key: item.texture.key, frame: item.frame.name,
            x: item.x, y: item.y, width: item.displayWidth, height: item.displayHeight,
            flipX: item.flipX, alpha: item.alpha,
            animation: item instanceof Phaser.GameObjects.Sprite ? item.anims.currentAnim?.key : null }));
      },
      /** Phase 17 玩法特性：中央章鱼触手是否已升起（E2E/调试观测口） */
      get octopus(): boolean {
        return self.octopusTentacle.isActive;
      },
      /** Phase 18 性能观测：全场景存活粒子数（QA / E2E 粒子预算断言） */
      get particles(): number {
        return self.countAliveParticles();
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
      /** Phase 14：联机诊断快照（离线 null） */
      get online(): object | null {
        return self.online !== null ? self.online.debugInfo() : null;
      },
      /** Phase 15：同步状态 / 恢复诊断（离线 null；E2E 断言恢复链用） */
      get syncState(): string | null {
        return self.online !== null ? self.online.syncState : null;
      },
      get recoveryCount(): number | null {
        return self.online !== null ? self.online.getSyncDiagnostics().recoveryCount : null;
      },
      get lastSyncReason(): string | null {
        return self.online !== null ? self.online.getSyncDiagnostics().lastSyncReason : null;
      },
      /**
       * Phase 15 DEBUG 工具：故意篡改 Guest 本地 turnId 制造 desync ——
       * 下一次 TURN_RESULT 边界自动检测 → 快照恢复闭环（E2E / 真机验收
       * 用；仅联机 Guest 生效，建议在对方回合触发）。
       */
      forceDesync(): void {
        self.online?.debugForceDesync();
      },
      get onlineRole(): string | null {
        return self.online?.role ?? null;
      },
      get localPlayerId(): string | null {
        return self.online?.localPlayerId ?? null;
      },
      get connectionLost(): boolean {
        return self.connectionLost;
      },
      /** 诊断：相机流事件环形日志（E2E 时序排查） */
      get cameraEventLog(): string[] {
        return [...self.cameraEventLog];
      },
      /**
       * E2E 用（仅 DEBUG_GAME）：优雅关闭联机通道 —— 触发对端
       * OPPONENT DISCONNECTED 完整链路（真实用户关标签页路径；
       * 进程异常崩溃依赖 ICE failed 判定，见 Known Issues）
       */
      closeOnlineChannel(): void {
        self.online?.transport.close();
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
    this.disconnectButton?.destroy();
    this.disconnectButton = null;
    // Phase 14：协调器与联机会话随对局结束彻底清理
    //（coordinator.dispose 尽力而为发 DISCONNECT；SessionManager 关
    // transport —— 对端经 onDisconnect 收到通知，gameOver 后被抑制）
    // Phase 16 例外：gameOver 转 ResultScene 的正常交接（handedToResult）
    // —— 旧协调器已交接给 Result（其 dispose 归 Result），session /
    // transport 保留供 Rematch 复用同一 WebRTC 连接。
    if (this.online !== null && !this.handedToResult) {
      this.online.dispose();
      this.online = null;
    }
    if (!this.handedToResult) {
      const sessionManager = this.registry.get(ONLINE_SESSION_MANAGER_KEY) as
        | OnlineSessionManager
        | undefined;
      sessionManager?.disposeSession();
    }
  }
}
