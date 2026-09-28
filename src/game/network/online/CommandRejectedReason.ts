/**
 * COMMAND_REJECTED 拒因全集（Phase 14，CODELY.md Host 权威校验）。
 *
 * 由 Host 在拒绝 Guest *_REQUEST 时随 CommandRejectedPayload 回发；
 * Guest 仅做轻量提示（Action rejected / State updated），状态本身
 * 从未本地执行，天然保持与 Host 一致（无需回滚）。
 *
 * 与 MovementRejectReason / FireRejectReason 的映射在
 * OnlineGameCoordinator 内维护（网络层单向 import 规则层，反向禁止）。
 */
export type CommandRejectedReason =
  /** 非当前回合玩家（含伪造 playerId / PLAYER_DEAD 场景归并） */
  | 'WRONG_TURN'
  /** TurnPhase 不允许该操作（含 GAME_OVER 后的任何请求） */
  | 'INVALID_PHASE'
  /** sender 不拥有该 Player / 玩家已阵亡 */
  | 'INVALID_PLAYER'
  /** targetX 非有限数 / 位置非法 */
  | 'INVALID_POSITION'
  /** moveRemaining 不足 */
  | 'MOVE_BUDGET_EXCEEDED'
  /** 本回合已发射 */
  | 'ALREADY_FIRED'
  /** FIRE 参数非法（速度 NaN/∞、超速、起点偏离炮塔、seed 不符、武器非法） */
  | 'INVALID_FIRE'
  /** turnId 落后于权威回合（重复/迟到请求） */
  | 'STALE_TURN';
