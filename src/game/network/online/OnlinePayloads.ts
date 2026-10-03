import { PLAYER_IDS } from '../../state/ids';
import { GAME_CONFIG } from '../../config/GameConfig';
import type { InventoryItem, ItemGenerationState, ShotContext } from '../../state/ItemState';
import type { AirstrikeContext } from '../../state/AirstrikeState';
import type { WorldItemState } from '../../state/WorldItemState';
import type { PlayerId, WeaponId, WorldItemType } from '../../state/ids';
import { TurnPhase } from '../../state/TurnPhase';
import type { CommandRejectedReason } from './CommandRejectedReason';
import type {
  AuthoritativeGameSnapshot,
  AuthoritativeOctopusSnapshot,
  AuthoritativePlayerSnapshot,
  CommandRejectedPayload,
  DisconnectPayload,
  FirePayload,
  FireRequestPayload,
  GameStartPayload,
  MovePayload,
  ItemStatePayload,
  UseItemRequestPayload,
  MoveRequestPayload,
  PlayerReadyPayload,
  StateSnapshotPayload,
  StateSyncReason,
  StateSyncRequestPayload,
  TurnEndPayload,
  TurnResultAckPayload,
  TurnResultPayload,
  TurnResultPlayerPayload,
} from './OnlineTypes';

/**
 * Phase 14 入站 payload 形状守卫 —— Untrusted Input 第一道防线。
 *
 * * 消费规则（OnlineTypes 安全边界）：Coordinator 收到的任何网络 payload
 *   必须先过对应守卫，不通过即丢弃并计数；本文件判定形状及触手字段
 *   自洽（HP / 出生 / 攻击历史）。回合归属 / 预算 / seed 比对归 Host 权威逻辑。
 * * 与 NetworkProtocol.validateEnvelope 同防御风格（拒 null / 数组 /
 *   原始值），但网络收到垃圾是预期情况 —— 这里返回 boolean，不抛错。
 * * 数值字段一律 Number.isFinite（拒 NaN / ±Infinity）；计数类字段
 *   （turnId / seed / hp / damages / epoch 时间戳）额外 Number.isInteger；
 *   字符串字段 typeof 检查，matchId / stateHash 额外非空。
 * * 多余字段忽略不算错：守卫与消费方只读取已校验字段、从不合并未知键，
 *   且 wire 输入经 JSON 序列化副本到达 —— 无原型污染注入面（白名单
 *   检查一律用 hasOwnProperty，防 'toString' 等原型链键伪造）。
 * * 全部纯函数，零 Phaser / DOM 依赖。
 */

// ---------------------------------------------------------------------------
// 复用小工具（全部导出：测试与后续 Coordinator 复用）
// ---------------------------------------------------------------------------

/** typeof number 且有限（拒 NaN / ±Infinity） */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** typeof number 且整数 */
export function isIntegerNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** typeof string 且非空 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** plain object 形状：拒 null / 数组；类实例由各字段检查自然拒绝 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** PlayerId 白名单（P1 | P2，大小写敏感） */
export function isPlayerId(value: unknown): value is PlayerId {
  return value === 'P1' || value === 'P2';
}

/** Side 白名单 */
export function isSide(value: unknown): value is 'left' | 'right' {
  return value === 'left' || value === 'right';
}

/** WeaponId 白名单（V0.1 仅 normal） */
export function isWeaponId(value: unknown): value is WeaponId {
  return value === 'normal';
}

/** TurnPhase 合法值白名单（enum 有运行时对象，直接驱动） */
const TURN_PHASE_VALUES: ReadonlySet<string> = new Set<string>(Object.values(TurnPhase));

export function isTurnPhaseValue(value: unknown): value is TurnPhase {
  return typeof value === 'string' && TURN_PHASE_VALUES.has(value);
}

/**
 * Record<PlayerId, T> 深校验：P1 / P2 双键齐备且逐项过校验。
 * 按 PLAYER_IDS 固定序遍历 —— 与对象自身键序无关。
 */
export function isPlayerIdRecord<T>(
  value: unknown,
  isValidEntry: (entry: unknown) => entry is T,
): value is Record<PlayerId, T> {
  if (!isPlainObject(value)) {
    return false;
  }
  for (const playerId of PLAYER_IDS) {
    if (!isValidEntry(value[playerId])) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// 权威快照（GAME_START.initialState；Phase 15 STATE_SNAPSHOT 复用）
// ---------------------------------------------------------------------------

export function isAuthoritativePlayerSnapshot(
  value: unknown,
): value is AuthoritativePlayerSnapshot {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isPlayerId(value.id) &&
    isSide(value.side) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isIntegerNumber(value.hp) &&
    isIntegerNumber(value.maxHp) &&
    isBoolean(value.isAlive) &&
    isFiniteNumber(value.moveRemaining) &&
    isBoolean(value.hasFired) &&
    isWeaponId(value.weaponId) &&
    isInventory(value.inventory) &&
    isBoolean(value.itemUsedThisTurn)
  );
}

/** Hazard counters are required; malformed or contradictory history cannot revive a dead tentacle. */
export function isAuthoritativeOctopusSnapshot(
  value: unknown,
  turnId: number,
): value is AuthoritativeOctopusSnapshot {
  if (!isPlainObject(value)) {
    return false;
  }
  const fields = ['hp', 'spawnTurnId', 'lastResolvedTurnId', 'lastAttackTurnId', 'lastAttackTarget'];
  if (fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    return false;
  }
  if (
    !isIntegerNumber(value.hp) || value.hp < 0 || value.hp > GAME_CONFIG.octopus.maxHp ||
    !isIntegerNumber(value.lastResolvedTurnId) || !Number.isSafeInteger(value.lastResolvedTurnId) ||
    value.lastResolvedTurnId < 0 || value.lastResolvedTurnId > turnId
  ) {
    return false;
  }
  if (value.spawnTurnId === null) {
    return value.hp === GAME_CONFIG.octopus.maxHp &&
      value.lastAttackTurnId === null && value.lastAttackTarget === null;
  }
  if (
    !isIntegerNumber(value.spawnTurnId) || !Number.isSafeInteger(value.spawnTurnId) ||
    value.spawnTurnId < 1 || value.spawnTurnId > turnId ||
    (value.spawnTurnId > value.lastResolvedTurnId &&
      !(value.spawnTurnId === turnId && value.hp === GAME_CONFIG.octopus.maxHp && value.lastAttackTurnId === null))
  ) {
    return false;
  }
  if (value.lastAttackTurnId === null) {
    return value.lastAttackTarget === null;
  }
  return isIntegerNumber(value.lastAttackTurnId) && Number.isSafeInteger(value.lastAttackTurnId) &&
    value.lastAttackTurnId >= value.spawnTurnId + GAME_CONFIG.octopus.attackAfterTurns &&
    value.lastAttackTurnId <= value.lastResolvedTurnId && isPlayerId(value.lastAttackTarget) &&
    (value.hp > 0 || value.lastAttackTurnId < value.lastResolvedTurnId);
}

export function isItemId(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 128;
}

function isItemType(value: unknown): value is WorldItemType {
  return value === 'heal' || value === 'damage_boost' || value === 'range_boost' || value === 'homing' || value === 'airstrike';
}

function isInventoryItem(value: unknown): value is InventoryItem {
  return isPlainObject(value) && isItemId(value.id) && isItemType(value.type);
}

export function isInventory(value: unknown): value is (InventoryItem | null)[] {
  return Array.isArray(value) && value.length === 3 &&
    value.every((item) => item === null || isInventoryItem(item)) &&
    new Set(value.filter((item) => item !== null).map((item) => item.id)).size === value.filter((item) => item !== null).length;
}

function isWorldItems(value: unknown, turnId: number): value is WorldItemState[] {
  return Array.isArray(value) && value.length <= 2 && value.every((item) =>
    isPlainObject(item) && isItemId(item.id) && isItemType(item.type) &&
    isFiniteNumber(item.x) && item.x >= 0 && item.x <= GAME_CONFIG.world.width &&
    isFiniteNumber(item.y) && item.y >= 0 && item.y <= GAME_CONFIG.world.height &&
    isBoolean(item.active) && Number.isSafeInteger(item.spawnTurnId) &&
    (item.spawnTurnId as number) >= 3 && (item.spawnTurnId as number) <= turnId &&
    item.expiresAtTurnId === (item.spawnTurnId as number) + 6
  ) && new Set(value.map((item) => item.id)).size === value.length;
}

function isItemGeneration(value: unknown, turnId: number): value is ItemGenerationState {
  return isPlainObject(value) && (value.firstWindowParity === 0 || value.firstWindowParity === 1) &&
    Number.isSafeInteger(value.lastWindowTurnId) && (value.lastWindowTurnId as number) >= 0 &&
    (value.lastWindowTurnId as number) <= turnId && Number.isSafeInteger(value.misses) &&
    (value.misses as number) >= 0 && (value.misses as number) <= 2 &&
    Number.isSafeInteger(value.nextId) && (value.nextId as number) >= 1;
}

function isShotContext(value: unknown, turnId: number): value is ShotContext | null {
  if (value === null) return true;
  if (!isPlainObject(value) || !isPlayerId(value.ownerId) || value.turnId !== turnId || !isBoolean(value.homingActivated)) return false;
  const noItem = value.itemId === undefined && value.itemType === undefined;
  const validItem = isItemId(value.itemId) && isItemType(value.itemType) && value.itemType !== 'heal' && value.itemType !== 'airstrike';
  if (!noItem && !validItem) return false;
  if (value.homingActivated && value.itemType !== 'homing') return false;
  if (value.homingTarget !== undefined && (!value.homingActivated || value.itemType !== 'homing')) return false;
  if (value.homingTarget !== undefined && (!isPlainObject(value.homingTarget) ||
    !isFiniteNumber(value.homingTarget.x) || !isFiniteNumber(value.homingTarget.y))) return false;
  return !value.homingActivated || value.homingTarget !== undefined;
}

/** Frozen target, legal resumable phase, and turn ownership are all public. */
export function isAirstrikeContext(value: unknown, turnId: number): value is AirstrikeContext {
  return isPlainObject(value) && isItemId(value.itemId) && isPlayerId(value.ownerId) &&
    value.turnId === turnId && isPlainObject(value.target) &&
    isFiniteNumber(value.target.x) && value.target.x >= 0 && value.target.x <= GAME_CONFIG.world.width &&
    isFiniteNumber(value.target.y) && value.target.y >= 0 && value.target.y <= GAME_CONFIG.world.height &&
    (value.resumePhase === TurnPhase.ACTION || value.resumePhase === TurnPhase.AIM);
}

type AirstrikeProjection = Pick<AuthoritativeGameSnapshot,
  'turnId' | 'currentPlayerId' | 'phase' | 'gameOver' | 'acceptedShot' | 'pendingAirstrike' | 'items'> & {
  players: Record<PlayerId, Pick<AuthoritativePlayerSnapshot,
    'x' | 'y' | 'hp' | 'isAlive' | 'hasFired' | 'itemUsedThisTurn' | 'inventory'>>;
};

function validAirstrikeOwner(context: AirstrikeContext, state: AirstrikeProjection): boolean {
  const owner = state.players[context.ownerId];
  const target = state.players[context.ownerId === 'P1' ? 'P2' : 'P1'];
  return context.ownerId === state.currentPlayerId && owner.isAlive && owner.hp > 0 &&
    owner.itemUsedThisTurn && !owner.hasFired && state.acceptedShot === null &&
    context.target.x === target.x && context.target.y === target.y - GAME_CONFIG.player.collision.height / 2 &&
    !state.items.some((item) => item.id === context.itemId) &&
    !PLAYER_IDS.some((id) => state.players[id].inventory.some((item) => item?.id === context.itemId));
}

function validPendingAirstrike(state: AirstrikeProjection): boolean {
  if (state.pendingAirstrike === null) return state.phase !== TurnPhase.AIRSTRIKE;
  return state.phase === TurnPhase.AIRSTRIKE && !state.gameOver &&
    isAirstrikeContext(state.pendingAirstrike, state.turnId) && validAirstrikeOwner(state.pendingAirstrike, state);
}

/** An item cannot exist in two bags or be in a bag and simultaneously on the field. */
function uniqueOwnedItems(value: { players: Record<PlayerId, { inventory: readonly (InventoryItem | null)[] }>; items: readonly WorldItemState[] }): boolean {
  const ids = [...value.items.map((item) => item.id), ...PLAYER_IDS.flatMap((id) => value.players[id].inventory.flatMap((item) => item === null ? [] : [item.id]))];
  return new Set(ids).size === ids.length;
}

export function isUseItemRequestPayload(value: unknown): value is UseItemRequestPayload {
  return isPlainObject(value) && isPlayerId(value.playerId) && isItemId(value.itemId) && isItemId(value.operationId) &&
    (value.resumePhase === undefined || value.resumePhase === TurnPhase.ACTION || value.resumePhase === TurnPhase.AIM);
}

export function isItemStatePayload(value: unknown): value is ItemStatePayload {
  if (!isPlainObject(value)) return false;
  const kind = value.kind;
  const valid = (kind === 'spawn' || kind === 'expire' || kind === 'pickup' || kind === 'homing' ||
    kind === 'heal' || kind === 'turn_start' || kind === 'airstrike_start' || kind === 'airstrike_end') &&
    isIntegerNumber(value.turnId) && value.turnId >= 1 && isPlayerId(value.currentPlayerId) &&
    isTurnPhaseValue(value.phase) && isBoolean(value.gameOver) &&
    (value.winnerId === null || isPlayerId(value.winnerId)) &&
    (value.itemId === undefined || isItemId(value.itemId)) &&
    (value.playerId === undefined || isPlayerId(value.playerId)) &&
    (value.x === undefined || isFiniteNumber(value.x)) && (value.y === undefined || isFiniteNumber(value.y)) &&
    (value.operationId === undefined || isItemId(value.operationId)) &&
    isPlayerIdRecord(value.players, (player): player is ItemStatePayload['players']['P1'] => isPlainObject(player) &&
      isFiniteNumber(player.x) && isFiniteNumber(player.y) && isBoolean(player.hasFired) &&
      isFiniteNumber(player.moveRemaining) && isBoolean(player.isAlive) &&
      isIntegerNumber(player.hp) && player.hp >= 0 && player.hp <= GAME_CONFIG.player.maxHp &&
      isInventory(player.inventory) && isBoolean(player.itemUsedThisTurn)) &&
    isAuthoritativeOctopusSnapshot(value.octopus, value.turnId) &&
    isWorldItems(value.items, value.turnId) && isItemGeneration(value.itemGeneration, value.turnId) &&
    isShotContext(value.acceptedShot, value.turnId) && uniqueOwnedItems(value as unknown as ItemStatePayload);
  if (!valid) return false;
  const projection = value as unknown as ItemStatePayload;
  if (!validPendingAirstrike(projection)) return false;
  if (kind !== 'airstrike_start' && kind !== 'airstrike_end') return value.airstrike === undefined;
  if (!isAirstrikeContext(value.airstrike, projection.turnId) ||
    projection.itemId !== value.airstrike.itemId || projection.playerId !== value.airstrike.ownerId ||
    !validAirstrikeOwner(value.airstrike, projection)) return false;
  if (kind === 'airstrike_start') {
    const pending = projection.pendingAirstrike;
    return pending !== null && pending.itemId === value.airstrike.itemId &&
      pending.ownerId === value.airstrike.ownerId && pending.turnId === value.airstrike.turnId &&
      pending.target.x === value.airstrike.target.x && pending.target.y === value.airstrike.target.y &&
      pending.resumePhase === value.airstrike.resumePhase && projection.winnerId === null;
  }
  if (projection.pendingAirstrike !== null ||
    PLAYER_IDS.some((id) => projection.players[id].isAlive !== (projection.players[id].hp > 0))) return false;
  const alive = PLAYER_IDS.filter((id) => projection.players[id].isAlive);
  if (alive.length === 2) return !projection.gameOver && projection.winnerId === null && projection.phase === value.airstrike.resumePhase;
  return projection.gameOver && projection.phase === TurnPhase.GAME_OVER && projection.winnerId === (alive[0] ?? null);
}

/**
 * V0.2 snapshot 深校验：有限坐标、类型、固定槽位、唯一拥有关系及生成/导引上下文。
 */
export function isAuthoritativeGameSnapshot(value: unknown): value is AuthoritativeGameSnapshot {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.matchId) &&
    isIntegerNumber(value.seed) &&
    isIntegerNumber(value.turnId) &&
    isPlayerId(value.currentPlayerId) &&
    isTurnPhaseValue(value.phase) &&
    isPlayerIdRecord(value.players, isAuthoritativePlayerSnapshot) &&
    isWorldItems(value.items, value.turnId) &&
    isItemGeneration(value.itemGeneration, value.turnId) &&
    isShotContext(value.acceptedShot, value.turnId) &&
    validPendingAirstrike(value as unknown as AuthoritativeGameSnapshot) &&
    isAuthoritativeOctopusSnapshot(value.octopus, value.turnId) &&
    isBoolean(value.gameOver) &&
    (value.winnerId === null || isPlayerId(value.winnerId)) &&
    uniqueOwnedItems(value as unknown as AuthoritativeGameSnapshot)
  );
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

/** PLAYER_READY：{ readyAt }（epoch ms 整数，与 envelope.timestamp 同税制） */
export function isPlayerReadyPayload(value: unknown): value is PlayerReadyPayload {
  return isPlainObject(value) && isIntegerNumber(value.readyAt) &&
    (value.rulesVersion === undefined || isNonEmptyString(value.rulesVersion));
}

/** GAME_START：深校验 initialState（Guest 重建本地状态的唯一依据） */
export function isGameStartPayload(value: unknown): value is GameStartPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.matchId) &&
    (value.rulesVersion === undefined || isNonEmptyString(value.rulesVersion)) &&
    isIntegerNumber(value.seed) &&
    value.hostPlayerId === 'P1' &&
    value.guestPlayerId === 'P2' &&
    isAuthoritativeGameSnapshot(value.initialState)
  );
}

// ---------------------------------------------------------------------------
// MOVE 同步
// ---------------------------------------------------------------------------

/** MOVE_REQUEST：帧增量为首选；旧 absolute 请求仍须经过 Host 限速。 */
export function isMoveRequestPayload(value: unknown): value is MoveRequestPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isPlayerId(value.playerId) &&
    (value.deltaX !== undefined || value.targetX !== undefined) &&
    (value.deltaX === undefined || isFiniteNumber(value.deltaX)) &&
    (value.targetX === undefined || isFiniteNumber(value.targetX))
  );
}

/** MOVE（Host → 双方）：权威移动结果（最终位置 + 剩余预算） */
export function isMovePayload(value: unknown): value is MovePayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isPlayerId(value.playerId) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.moveRemaining)
  );
}

// ---------------------------------------------------------------------------
// FIRE 同步
// ---------------------------------------------------------------------------

/** FIRE_REQUEST（Guest → Host）：canonical 速度向量 + seed 整数 */
export function isFireRequestPayload(value: unknown): value is FireRequestPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isPlayerId(value.playerId) &&
    isWeaponId(value.weaponId) &&
    isFiniteNumber(value.startX) &&
    isFiniteNumber(value.startY) &&
    isFiniteNumber(value.velocityX) &&
    isFiniteNumber(value.velocityY) &&
    isIntegerNumber(value.seed) &&
    (value.itemId === undefined || isItemId(value.itemId))
  );
}

/** FIRE（Host → Guest）：canonical FireCommand（去 type 字段），turnId 随命令走 */
export function isFirePayload(value: unknown): value is FirePayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isPlayerId(value.playerId) &&
    isIntegerNumber(value.turnId) &&
    isWeaponId(value.weaponId) &&
    isFiniteNumber(value.startX) &&
    isFiniteNumber(value.startY) &&
    isFiniteNumber(value.velocityX) &&
    isFiniteNumber(value.velocityY) &&
    isIntegerNumber(value.seed) &&
    (value.itemId === undefined || isItemId(value.itemId))
  );
}

// ---------------------------------------------------------------------------
// 回合收口
// ---------------------------------------------------------------------------

/** TURN_RESULT.players 项：位置 / 血量整数 / 布尔 / 预算全字段 */
function isTurnResultPlayerPayload(value: unknown): value is TurnResultPlayerPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isIntegerNumber(value.hp) &&
    isIntegerNumber(value.hpBefore) &&
    isBoolean(value.isAlive) &&
    isFiniteNumber(value.moveRemaining) &&
    isBoolean(value.hasFired) &&
    isInventory(value.inventory) && isBoolean(value.itemUsedThisTurn)
  );
}

/** impact：null（出界 / 无爆炸）或 { x, y } 有限数 */
function isImpactPoint(value: unknown): value is { readonly x: number; readonly y: number } {
  if (!isPlainObject(value)) {
    return false;
  }
  return isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isDamageRecord(value: unknown): value is Readonly<Record<PlayerId, number>> {
  return isPlayerIdRecord(value, isIntegerNumber);
}

/**
 * TURN_RESULT：Host 权威结算深校验 —— players 双方全字段、damages 双键
 * 整数、impact null|点、winnerId / nextPlayerId null|PlayerId、stateHash 非空。
 */
export function isTurnResultPayload(value: unknown): value is TurnResultPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isIntegerNumber(value.turnId) &&
    (value.impact === null || isImpactPoint(value.impact)) &&
    isPlayerIdRecord(value.players, isTurnResultPlayerPayload) &&
    isDamageRecord(value.damages) &&
    isAuthoritativeOctopusSnapshot(value.octopus, value.turnId) &&
    isWorldItems(value.items, value.turnId) && isItemGeneration(value.itemGeneration, value.turnId) &&
    isShotContext(value.acceptedShot, value.turnId) && value.pendingAirstrike === null &&
    uniqueOwnedItems(value as unknown as TurnResultPayload) &&
    isBoolean(value.gameOver) &&
    (value.winnerId === null || isPlayerId(value.winnerId)) &&
    (value.nextPlayerId === null || isPlayerId(value.nextPlayerId)) &&
    isIntegerNumber(value.nextTurnId) &&
    isNonEmptyString(value.stateHash)
  );
}

/** TURN_END：Turn Barrier 授权（下一玩家 + 下一 turnId） */
export function isTurnEndPayload(value: unknown): value is TurnEndPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return isPlayerId(value.nextPlayerId) && isIntegerNumber(value.nextTurnId);
}

// ---------------------------------------------------------------------------
// Phase 15 —— Desync 恢复 payload 守卫
// ---------------------------------------------------------------------------

/** StateSyncReason 白名单（编译期穷举 + 运行时 hasOwnProperty 防原型链） */
const STATE_SYNC_REASON_FLAGS: Readonly<Record<StateSyncReason, true>> = {
  HASH_MISMATCH: true,
  MISSING_TURN_RESULT: true,
  INVALID_LOCAL_STATE: true,
  MANUAL_DEBUG: true,
  CONNECTION_RECOVERED: true,
};

export function isStateSyncReason(value: unknown): value is StateSyncReason {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(STATE_SYNC_REASON_FLAGS, value)
  );
}

/** STATE_SYNC_REQUEST（Guest → Host）：expectedTurnId 整数 + 双 hash 非空 + reason 枚举 */
export function isStateSyncRequestPayload(value: unknown): value is StateSyncRequestPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isIntegerNumber(value.expectedTurnId) &&
    isNonEmptyString(value.localStateHash) &&
    isNonEmptyString(value.authoritativeHash) &&
    isStateSyncReason(value.reason)
  );
}

/** STATE_SNAPSHOT（Host → Guest）：深校验 snapshot + hash 自洽由 SnapshotValidator 负责 */
export function isStateSnapshotPayload(value: unknown): value is StateSnapshotPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isAuthoritativeGameSnapshot(value.snapshot) &&
    isNonEmptyString(value.stateHash) &&
    isIntegerNumber(value.generatedAtTurnId)
  );
}

/** TURN_RESULT_ACK（Guest → Host）：Sync Barrier 确认 */
export function isTurnResultAckPayload(value: unknown): value is TurnResultAckPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isIntegerNumber(value.turnId) &&
    isNonEmptyString(value.stateHash) &&
    isBoolean(value.recovered)
  );
}

// ---------------------------------------------------------------------------
// 异常路径
// ---------------------------------------------------------------------------

/**
 * CommandRejectedReason 白名单。字符串联合无运行时对象 —— 用
 * Record<CommandRejectedReason, true> 强制编译期穷举（契约新增 reason
 * 而此处未跟会直接编译失败）。运行时用 hasOwnProperty 而非 `in`
 * （'toString' 等原型链键必须拒绝）。
 */
const COMMAND_REJECTED_REASON_FLAGS: Readonly<Record<CommandRejectedReason, true>> = {
  WRONG_TURN: true,
  INVALID_PHASE: true,
  INVALID_PLAYER: true,
  INVALID_POSITION: true,
  MOVE_BUDGET_EXCEEDED: true,
  ALREADY_FIRED: true,
  INVALID_FIRE: true,
  STALE_TURN: true,
  INVALID_ITEM: true,
  ITEM_ALREADY_USED: true,
  HP_FULL: true,
};

function isCommandRejectedReason(value: unknown): value is CommandRejectedReason {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(COMMAND_REJECTED_REASON_FLAGS, value)
  );
}

/** COMMAND_REJECTED：commandType 双值 + reason 白名单 */
export function isCommandRejectedPayload(value: unknown): value is CommandRejectedPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    (value.commandType === 'MOVE' || value.commandType === 'FIRE' || value.commandType === 'USE_ITEM') &&
    (value.operationId === undefined || isItemId(value.operationId)) &&
    isCommandRejectedReason(value.reason)
  );
}

/** DISCONNECT：reason 任意 string（允许空串 —— 展示层有兜底文案） */
export function isDisconnectPayload(value: unknown): value is DisconnectPayload {
  return isPlainObject(value) && typeof value.reason === 'string';
}
