import type { CommandBus } from '../../commands/CommandBus';
import type { FireCommand } from '../../commands/GameCommand';
import type { DamageResult } from '../../state/DamageResult';
import type { ProjectileImpact } from '../../state/ExplosionEvent';
import type { GameState } from '../../state/GameState';
import type { PlayerId, WeaponId } from '../../state/ids';
import type { TurnPhase } from '../../state/TurnPhase';
import type { WorldItemState } from '../../state/WorldItemState';
import type { CommandRejectedReason } from './CommandRejectedReason';
import type { DamageSystem } from '../../systems/DamageSystem';
import type { GameLogic } from '../../systems/GameLogic';
import type { TurnManager } from '../../systems/TurnManager';
import type { NetworkTransport } from '../NetworkTransport';
import type { OnlineSession } from '../OnlineSession';
import type { PeerRole } from '../PeerRole';
import type { TransportState } from '../TransportState';
import type { OnlineSyncState } from './sync/OnlineSyncState';

/**
 * Phase 14 联机协议契约（HOST AUTHORITATIVE，CODELY.md §5/§6）。
 *
 * 消息流总览（双方同版本；值即 wire 协议，见 NetworkMessageType）：
 *
 *   Lobby：  PLAYER_READY（双向）→ Host 汇齐双 Ready → GAME_START（Host→Guest）
 *   回合中：Guest MOVE_REQUEST / FIRE_REQUEST → Host 校验（复用同一套
 *           MovementSystem / FireSystem 路径）→ 广播 MOVE / FIRE
 *   收口：  Host TURN_RESULT（authoritative snapshot + damages + stateHash）
 *           → Host dwell 完成 → TURN_END（授权进入下一回合）
 *   异常：  COMMAND_REJECTED（拒因回执，不 disconnect）/ DISCONNECT
 *
 * 安全边界（CODELY.md Phase 14 规约）：
 * * 所有网络 payload 均为 Untrusted Input —— 消费前必须过
 *   online/OnlinePayloads 的形状守卫（本文件只定义类型）。
 * * Guest 只能提交 Intent（targetX / 发射参数）；HP / Damage / Winner /
 *   位置 / 预算 / 回合归属全部由 Host 计算。
 * * 禁止逐帧同步炮弹坐标 —— FIRE 携带初始参数，双方本地模拟，
 *   结果以 Host TURN_RESULT 为准。
 *
 * 本文件零运行时代码（纯类型 + 协议文档）；实现见 online/ 其余模块。
 */

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

/** PLAYER_READY：进入对局就绪（payload 需非 undefined，故带 readyAt 戳） */
export interface PlayerReadyPayload {
  /** 发送时刻（epoch ms）—— 仅诊断用途，Host 不依赖其顺序 */
  readonly readyAt: number;
}

/**
 * GAME_START：Host 生成的对局种子与权威初始快照。
 * Guest 禁止自行产生 seed / 初始位置 / 首位玩家 —— 一律以本 payload 为准。
 */
export interface GameStartPayload {
  /** 对局 ID（Host 生成；进入 GameState.matchId 与 stateHash） */
  readonly matchId: string;
  /** 对局种子（AI / 未来道具等全部 SeededRandom 派生源） */
  readonly seed: number;
  /** 固定映射：Host = P1，Guest = P2（Phase 13 起） */
  readonly hostPlayerId: 'P1';
  readonly guestPlayerId: 'P2';
  /** 权威初始快照（phase = START，双方据此重建本地 GameState） */
  readonly initialState: AuthoritativeGameSnapshot;
}

// ---------------------------------------------------------------------------
// 权威快照（协议层稳定投影，禁止直接把 GameState 当 wire 类型 ——
// GameState 演进不得隐式改变 wire 协议）
// ---------------------------------------------------------------------------

export interface AuthoritativePlayerSnapshot {
  readonly id: PlayerId;
  readonly side: 'left' | 'right';
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly isAlive: boolean;
  readonly moveRemaining: number;
  readonly hasFired: boolean;
  readonly weaponId: WeaponId;
}

/**
 * 权威对局快照。V0.1 items 恒为空数组（Phase 17 才有 Item Gameplay），
 * 但保留字段保证快照形状与 GameState 对齐、Phase 15 desync 对比可用。
 */
export interface AuthoritativeGameSnapshot {
  readonly matchId: string;
  readonly seed: number;
  readonly turnId: number;
  readonly currentPlayerId: PlayerId;
  readonly phase: TurnPhase;
  readonly players: Readonly<Record<PlayerId, AuthoritativePlayerSnapshot>>;
  readonly items: readonly WorldItemState[];
  readonly gameOver: boolean;
  readonly winnerId: PlayerId | null;
}

// ---------------------------------------------------------------------------
// MOVE 同步
// ---------------------------------------------------------------------------

/** Guest → Host：移动意图（只有 Intent，无任何结果字段） */
export interface MoveRequestPayload {
  readonly playerId: PlayerId;
  readonly targetX: number;
}

/** Host → 双方语义（Host 本地已有，Guest 应用）：权威移动结果 */
export interface MovePayload {
  readonly playerId: PlayerId;
  /** Host 结算后的最终位置 —— Guest 直接覆盖（不依赖本地输入模拟） */
  readonly x: number;
  readonly moveRemaining: number;
}

// ---------------------------------------------------------------------------
// FIRE 同步
// ---------------------------------------------------------------------------

/** Guest → Host：发射意图（canonical 数据 = 速度向量，不发 angle/power） */
export interface FireRequestPayload {
  readonly playerId: PlayerId;
  readonly weaponId: WeaponId;
  readonly startX: number;
  readonly startY: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly seed: number;
}

/** Host → Guest：canonical FireCommand（与本地 FIRE 命令同构，双端本地播放） */
export type FirePayload = Omit<FireCommand, 'type'>;

// ---------------------------------------------------------------------------
// 回合收口（Host authoritative resolution）
// ---------------------------------------------------------------------------

export interface TurnResultPlayerPayload {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  /** 结算前血量（Guest 伤害数字展示用） */
  readonly hpBefore: number;
  readonly isAlive: boolean;
  readonly moveRemaining: number;
  readonly hasFired: boolean;
}

/**
 * TURN_RESULT：Host 权威结算。Guest 收到后必须 reconcile（覆盖本地
 * prediction）：HP / 位置 / 存活 / gameOver / winner 一律以 Host 为准；
 * damage number 也以本 payload 的 damages 展示（不显示本地预测值）。
 * impact 为 null = 出界（无爆炸无伤害）。gameOver=true 时 nextPlayerId
 * 为 null（无下一回合，Host 不再发 TURN_END）。
 */
export interface TurnResultPayload {
  readonly turnId: number;
  readonly impact: { readonly x: number; readonly y: number } | null;
  readonly players: Readonly<Record<PlayerId, TurnResultPlayerPayload>>;
  /** 本回合每个玩家的最终伤害（0 = 未命中） */
  readonly damages: Readonly<Record<PlayerId, number>>;
  readonly gameOver: boolean;
  readonly winnerId: PlayerId | null;
  readonly nextPlayerId: PlayerId | null;
  readonly nextTurnId: number;
  /** 基础状态哈希（Phase 14 仅计算与携带；Phase 15 消费做 desync 防护） */
  readonly stateHash: string;
}

/** TURN_END：Host 授权正式进入下一 Turn（Turn Barrier 收口信号） */
export interface TurnEndPayload {
  readonly nextPlayerId: PlayerId;
  readonly nextTurnId: number;
}

// ---------------------------------------------------------------------------
// 异常路径
// ---------------------------------------------------------------------------

/** COMMAND_REJECTED：Host 拒绝非法请求（轻量回执，不 disconnect） */
export interface CommandRejectedPayload {
  readonly commandType: 'MOVE' | 'FIRE';
  readonly reason: CommandRejectedReason;
}

/** DISCONNECT：主动退出通知（对端据此展示 OPPONENT DISCONNECTED） */
export interface DisconnectPayload {
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Phase 15 —— Desync 检测与状态恢复（Turn Boundary 同步）
// ---------------------------------------------------------------------------

/** Guest 检测到状态偏差的原因（诊断 + Host 决策用） */
export type StateSyncReason =
  | 'HASH_MISMATCH'
  | 'MISSING_TURN_RESULT'
  | 'INVALID_LOCAL_STATE'
  | 'MANUAL_DEBUG';

/** STATE_SYNC_REQUEST（Guest → Host）：请求权威快照恢复本地状态 */
export interface StateSyncRequestPayload {
  /** Guest 发起恢复时的本地 turnId（Host 据此校验请求合理性） */
  readonly expectedTurnId: number;
  /** Guest 本地重算 hash（诊断：Host 可记录两端差异） */
  readonly localStateHash: string;
  /** Guest 观察到的 Host 权威 hash（来自 TURN_RESULT.stateHash） */
  readonly authoritativeHash: string;
  readonly reason: StateSyncReason;
}

/** STATE_SNAPSHOT（Host → Guest）：权威快照回复 */
export interface StateSnapshotPayload {
  readonly snapshot: AuthoritativeGameSnapshot;
  /** Host 对该快照重算的 hash —— Guest apply 后必须复验一致 */
  readonly stateHash: string;
  /** 快照生成时的权威 turnId（Guest 据此拒收过期快照） */
  readonly generatedAtTurnId: number;
}

/** TURN_RESULT_ACK（Guest → Host）：Sync Barrier 确认（Phase 15） */
export interface TurnResultAckPayload {
  /** 被确认的 TURN_RESULT.turnId */
  readonly turnId: number;
  /** Guest apply 后复验一致的 hash */
  readonly stateHash: string;
  /** true = 经历了 snapshot 恢复后才确认 */
  readonly recovered: boolean;
}

/** Phase 15 同步诊断口径（getSyncDiagnostics 与 OnlineDebugInfo 并联） */
export interface StateSyncDiagnostics {
  /** 成功的 snapshot 恢复次数（Host 恒 0 —— 权威端无需恢复） */
  readonly recoveryCount: number;
  /** 最近一次同步事件原因（null = 本局尚未发生任何同步事件；粘性，不随干净边界清除） */
  readonly lastSyncReason: string | null;
  /** 本端最近一次边界重算 hash */
  readonly localHash: string | null;
  /** 对端权威 hash（Guest = TURN_RESULT.stateHash / SNAPSHOT.stateHash；Host = 收到的 ACK hash） */
  readonly hostHash: string | null;
}

// ---------------------------------------------------------------------------
// Bootstrap（Lobby → BattleScene 携带）
// ---------------------------------------------------------------------------

/**
 * 联机对局启动载荷：OnlineConnectionScene 经 scene.start 注入 BattleScene。
 * coordinator 为同一实例（Lobby 阶段创建，Battle 阶段 attach 系统）——
 * 禁止重建第二个连接或第二个 coordinator。
 */
export interface OnlineBattleBootstrap {
  readonly role: PeerRole;
  /** Host = 本地构建；Guest = 网络接收（同一份契约，双方状态同源） */
  readonly gameStart: GameStartPayload;
  readonly coordinator: OnlineGameCoordinatorApi;
}

// ---------------------------------------------------------------------------
// OnlineGameCoordinator 公共 API（实现：online/OnlineGameCoordinator.ts）
// ---------------------------------------------------------------------------

/** Lobby 阶段回调（OnlineConnectionScene 消费） */
export interface OnlineLobbyHandlers {
  /** GAME_START 就绪（Host 汇齐双 Ready 本地触发；Guest 收到校验通过触发） */
  onStart(bootstrap: OnlineBattleBootstrap): void;
  /** 通道中断（Lobby 期：回连接页提示） */
  onDisconnected(reason?: string): void;
}

/** Battle 阶段依赖（BattleScene.attach 注入；实现回写本地表现） */
export interface OnlineBattleDeps {
  /** 权威逻辑状态引用（Host = 权威本体；Guest = 本地镜像） */
  getState(): GameState;
  /** 真实执行总线（GameLogic 已订阅）—— Guest 收到权威 FIRE 经此本地播放 */
  readonly commandBus: CommandBus;
  /** Host 广播源：订阅 CommandOutcome（accepted/rejected 均发）。
   * 实现 red line：outcome handler 内禁止向 commandBus dispatch（重入），
   * 只允许发送网络消息。 */
  readonly gameLogic: GameLogic;
  readonly turnManager: TurnManager;
  /**
   * Guest 专属：Turn Barrier 授权后（本地 dwell 完成 + TURN_END 到达）
   * 由 coordinator 应用远程回合并回调此处 —— 场景只做相机转场收尾
   * （transitionToPlayer → notifyTurnTransitionComplete）。
   */
  resumeNextTurn(): void;
  /** Guest 专属：权威伤害数字展示（复用 DamageResult 形状） */
  showAuthoritativeDamage(result: DamageResult): void;
  /** Guest 收到 COMMAND_REJECTED 的轻量提示入口 */
  showRejected(payload: CommandRejectedPayload): void;
  /** Battle 期通道中断（场景冻结输入并展示 OPPONENT DISCONNECTED） */
  onDisconnected(reason?: string): void;
  /**
   * Phase 15 desync 恢复接线（BattleScene 注入）。可选 = 接线完成前保持
   * 编译绿；接线后即生效。
   */
  /** Guest 恢复期间锁 Move/Aim/Fire（Host 等 ACK 期无需锁） */
  setSyncLock?(locked: boolean): void;
  /** 同步状态变化（场景显示 SYNCING / SYNC_FAILED 提示） */
  onSyncStateChange?(state: OnlineSyncState, detail?: string): void;
  /** SYNC_FAILED 终局（场景终止比赛回菜单；每场恰一次） */
  onSyncFailure?(): void;
}

export interface OnlineCoordinatorOptions {
  /** Phase 13 已验证的会话（不重建连接） */
  readonly session: OnlineSession;
  /**
   * Host 生成对局身份（matchId + seed）。对局-setup 随机不属于
   * Gameplay RNG（CODELY.md §16 管的是局内随机），生产实现用
   * Date.now / Math.random / crypto 均可；测试注入固定值。
   */
  readonly createMatchIdentity: () => { matchId: string; seed: number };
  /** Phase 15：Host TURN_RESULT → ACK 等待超时（默认 8s；测试注入短值） */
  readonly hostAckTimeoutMs?: number;
}

/** DEBUG_NETWORK overlay + E2E 观测快照 */
export interface OnlineDebugInfo {
  readonly role: PeerRole;
  readonly localPlayerId: PlayerId;
  readonly remotePlayerId: PlayerId;
  readonly matchId: string | null;
  readonly netState: TransportState;
  readonly pingMs: number | null;
  readonly lastRxType: string | null;
  readonly lastTxType: string | null;
  /** 已拒绝的 Guest 请求数（防刷 / E2E 断言） */
  readonly rejectedCount: number;
  /** Guest 侧收到的 TURN_RESULT stateHash 与本地计算是否一致 */
  readonly lastHashMatch: boolean | null;
  /** Phase 15 desync 诊断（battle 期前为初始值；字段与 StateSyncDiagnostics 对齐） */
  readonly syncState?: OnlineSyncState;
  readonly recoveryCount?: number;
  readonly lastSyncReason?: string | null;
  readonly localHash?: string | null;
  readonly hostHash?: string | null;
}

/**
 * 联机协调器公共契约 —— Host / Guest 网络分支的唯一集中点
 * （架构红线：TurnManager / Movement / Projectile 系统内禁止 if (isHost)，
 * BattleScene 仅经本接口与网络层交互）。
 *
 * 生命周期：Lobby（enterLobby / sendPlayerReady）→ attach（Battle）→ dispose。
 * 实现必须保证：消息幂等（sequence + turnId 双防线）、stale/future turn
 * 拒绝、所有入站 payload 过形状守卫、gameOver 后抑制 disconnect 提示。
 */
export interface OnlineGameCoordinatorApi {
  readonly role: PeerRole;
  readonly localPlayerId: PlayerId;
  readonly remotePlayerId: PlayerId;
  readonly transport: NetworkTransport;

  /** Lobby：订阅 GAME_START / 断线；返回取消函数（转场前调用） */
  enterLobby(handlers: OnlineLobbyHandlers): () => void;
  /** Lobby：发送 PLAYER_READY（Host 汇齐双 Ready 即构建并发送 GAME_START） */
  sendPlayerReady(): void;

  /** Battle：注入系统依赖（必须在场景 create 早期、输入源接线前调用） */
  attach(deps: OnlineBattleDeps): void;
  /**
   * 输入总线：场景把它交给 Touch/Desktop/AimController。
   * Host = 真实执行总线（本地权威执行，outcome 钩子负责广播）；
   * Guest = 意图总线（本地命令 → *_REQUEST，不本地执行）。
   */
  readonly inputBus: CommandBus;
  /**
   * 伤害系统注入：Host = 常规 ConcreteDamageSystem；
   * Guest = calculate-only（本地 HP 只经 TURN_RESULT reconcile 改写）。
   */
  readonly damageSystem: DamageSystem;
  /** 当前是否本地玩家回合（输入锁 / HUD 标签用；需已 attach） */
  isLocalTurn(): boolean;
  /**
   * 场景在本地结算完成时调用（onImpact / onOutOfBounds 处）：
   * Host → 构建并发送 TURN_RESULT；Guest → 记录 pending（伤害展示
   * 与 Turn Barrier 的本地半条件）。result 为本地 ExplosionSystem
   * 结算产物（Host = 权威结果；Guest = 仅预测，供 display 合成），
   * 出界传 (null, null)。
   */
  notifyTurnResolved(impact: ProjectileImpact | null, result: DamageResult | null): void;
  /**
   * 场景爆炸停留结束时调用（onAttackResolved）：
   * Host → 发送 TURN_END 并返回 'proceed'（场景自行 endTurn，本地权威）；
   * Guest → 双条件（本地 dwell ✓ + TURN_END ✓）满足则应用远程回合并
   * 返回 'proceed'，否则记录并返回 'waiting'（TURN_END 到达时经
   * resumeNextTurn 回调补驱）；gameOver 时 Host 不发 TURN_END
   * （Guest 由 update 循环的 gameOver 检测接管收口）。
   */
  onLocalAttackResolved(): 'proceed' | 'waiting';

  /** Phase 15：当前同步状态（SYNCED / 恢复链各态 / SYNC_FAILED；单一事实源） */
  readonly syncState: OnlineSyncState;
  /**
   * Phase 15 终局 gate：Guest 在 gameOver TURN_RESULT hash 确认后为 true
   * （场景 update 循环消费 → 转 Result）；Host 权威 gameOver 即 true。
   */
  isFinalStateConfirmed(): boolean;
  /** Phase 15 desync 诊断（DEBUG_NETWORK / E2E） */
  getSyncDiagnostics(): StateSyncDiagnostics;
  /**
   * DEBUG_GAME 专用：Guest 篡改本地状态制造 desync —— 下一次
   * TURN_RESULT 边界自动 mismatch 并走完整恢复链。Host 调用为 no-op。
   */
  debugForceDesync(): void;

  /** Battle 期保活（2s PING；测试不调用即零定时器） */
  startKeepAlive(): void;
  readonly lastRttMs: number | null;

  /** 诊断快照（DEBUG_NETWORK / E2E） */
  debugInfo(): OnlineDebugInfo;
  /** 尽力而为发送 DISCONNECT + 清理订阅；Session 销毁由 SessionManager 负责 */
  dispose(): void;
}
