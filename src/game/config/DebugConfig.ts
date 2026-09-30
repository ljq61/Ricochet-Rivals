/**
 * 开发阶段 Debug Overlay 总开关。
 * 发布 / 演示时改为 false 即可隐藏所有 Debug UI。
 */
export const DEBUG_GAME: boolean = true;

/** Art preview keeps E2E handles available without obscuring the player HUD. */
export const DEBUG_OVERLAY: boolean = false;

/**
 * Phase 14：联机网络调试信息开关（Debug Overlay 的 NETWORK 段，
 * 以及 E2E 观测句柄中的 online 字段）。依赖 DEBUG_GAME 的 Overlay 本体。
 * 要求显示：ROLE / LOCAL PLAYER / REMOTE PLAYER / MATCH ID / TURN ID /
 * NETWORK STATE / LAST RX / LAST TX / PING。
 */
export const DEBUG_NETWORK: boolean = true;

/**
 * SG-6：强制全 relay（iceTransportPolicy='relay'）—— 验证 TURN 确实可用的
 * 开发选项（真实浏览器查 selected candidate pair 须含 relay candidate）。
 * Production 必须保持 false（默认 'all'：能直连直连，TURN 只做兜底）。
 */
export const DEBUG_FORCE_RELAY: boolean = false;
