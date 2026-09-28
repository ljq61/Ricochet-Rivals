/**
 * GameConfig — 所有 Gameplay 参数的唯一来源。
 *
 * 规则（见 CODELY.md §7）：
 * - 禁止在系统代码中散落 magic numbers。
 * - Gameplay 概念保持统一单位（px / px/s / px/s² / ms）。
 * - 如 Phaser Matter 单位实现不同，仅在 Physics Adapter 层转换。
 */
export const GAME_CONFIG = {
  world: {
    width: 5000,
    height: 1080,
    /** 地面顶部 Y 坐标（地面填充到世界底部） */
    groundTopY: 960,
  },

  player: {
    maxHp: 10,

    maxMovePerTurn: 250,

    leftBounds: {
      minX: 100,
      maxX: 850,
    },

    rightBounds: {
      minX: 4150,
      maxX: 4900,
    },

    spawn: {
      P1: 450,
      P2: 4550,
    },

    /** 本地按住方向键的移动手感参数（AI / 网络直接发 MoveCommand，不走加速） */
    movement: {
      maxSpeed: 320,
      acceleration: 2400,
    },

    /** 发射原点：相对炮手脚底坐标的偏移（炮塔位置） */
    launcher: {
      offsetY: -48,
    },

    /** 炮手碰撞体尺寸（占位视觉的物理表示：身宽 28，含头顶总高 76） */
    collision: {
      width: 28,
      height: 76,
    },
  },

  camera: {
    /** RETURN_HOME：相机 Tween 回当前炮手的时长 */
    returnHomeDurationMs: 350,
    /** PROJECTILE_FOLLOW：平滑跟随速率（每秒收敛比例，10 ≈ 温和跟随不硬锁） */
    projectileFollowRate: 10,
    /** IMPACT：聚焦爆炸点的收敛速率（比跟随更快贴住） */
    impactFocusRate: 16,
    /** IMPACT：爆炸点停留时长（CODELY.md：700～1000ms） */
    impactStayMs: 850,
    /** TURN_TRANSITION：回合切换时相机平移到新玩家的时长（Phase 8） */
    turnTransitionDurationMs: 600,
    /** FREE_VIEW 内点击「己方 / 敌方」快捷聚焦的平移时长 */
    panDurationMs: 450,
  },

  /**
   * Viewport 策略（CODELY.md §25 + Phase 6.5）：
   * 纵向构图稳定 —— 所有设备显示相同的世界纵向范围（worldViewHeight），
   * zoom = viewportHeight / worldViewHeight；超宽屏（19.5:9 / 20:9）自然
   * 看到更多横向场景，而不是把 16:9 画布强行 FIT 浪费两侧空间。
   * 禁止因设备分辨率改变 World / Physics / Movement / Explosion 参数。
   */
  viewport: {
    /** 目标可见世界高度（纵向构图锚点；= world.height 时桌面 16:9 与 zoom 1 完全一致） */
    worldViewHeight: 1080,
    /** 防御性 clamp：极端视口（过矮 / 过高窗口）下的缩放上下限 */
    minZoom: 0.3,
    maxZoom: 3,
  },

  /**
   * 平台差异化输入参数（Phase 6.5）。
   * 只允许调整"输入采集"相关数值；规则校验全部在 MovementSystem / FireSystem。
   */
  controls: {
    desktop: {
      /** 桌面鼠标精确，无死区：pointerdown 即激活瞄准 */
      aimDeadZoneScreenPx: 0,
    },
    touch: {
      /** 瞄准起始判定半径（屏幕 px，换算回世界坐标比较；约一根拇指的落点范围） */
      aimStartRadiusScreenPx: 150,
      /** 瞄准死区：拖动超过该屏幕距离才激活，防止误触/抖动开火 */
      aimDeadZoneScreenPx: 14,
    },
  },

  aiming: {
    maxDragDistance: 180,
    minPower: 0.15,
    /** 发起瞄准的点击判定半径（炮手附近） */
    startRadius: 180,
    minLaunchSpeed: 550,
    /**
     * 2026-09-28 调参：1400 → 2400。
     * 原建议值 1400 的最大射程 = v²/g = 1960px，而双方阵地最短间距
     * ~3300px、最坏情况 4800px，物理上无法命中对面。
     * 2400 的 45° 射程 5760px：覆盖最坏情况并留余量；满力 45° 会
     * 飞出对侧边界（收力是技巧的一部分）。
     */
    maxLaunchSpeed: 2400,
    previewDuration: 0.8,
    previewPoints: 12,
  },

  physics: {
    gravityX: 0,
    gravityY: 1000,
    projectileLifetimeMs: 8000,
  },

  projectile: {
    radius: 16,
    /**
     * 引信距离：炮弹出生点在炮手碰撞体内，飞离发射点该距离前
     * 不与玩家碰撞（否则发射瞬间自爆）。之后引信一直保持激活，
     * 抛物线回落砸中发射者同样爆炸。
     */
    playerCollisionArmDistance: 100,
    /** IMPACT → EXPLODING 占位爆炸动画时长，随后 DESTROYED */
    explodeDurationMs: 280,
  },

  explosion: {
    radius: 140,
    directDamageRadius: 60,
    directDamage: 2,
    splashDamage: 1,
    /** 反馈（Placeholder）：爆炸时相机抖动（Phaser Shake：渲染矩阵偏移） */
    shakeDurationMs: 300,
    shakeIntensity: 0.012,
  },

  /**
   * Single Player AI（Phase 10，CODELY.md §18）。
   * 三档难度共用同一套决策逻辑，仅误差幅度不同（禁止三套 AI 代码）；
   * 全部 Gameplay 随机经 SeededRandom（CODELY.md §16 禁止 Math.random）。
   */
  ai: {
    /** 思考延迟：AIInputSource 表现层节奏（决策本身零延迟、纯函数） */
    thinkDelayMs: {
      min: 500,
      max: 900,
    },
    /** 移动后到发射之间的停顿 */
    postMoveDelayMs: {
      min: 250,
      max: 500,
    },
    /** 无可行解时的尽力弹仰角（deg，朝敌方方向的低弹道） */
    fallbackAngleDeg: 30,
    /** 难度参数：aimErrorDeg = 角度误差（±deg）；powerErrorRatio = 力度误差（速度 ±比例） */
    difficulties: {
      easy: {
        aimErrorDeg: 16,
        powerErrorRatio: 0.25,
      },
      normal: {
        aimErrorDeg: 8,
        powerErrorRatio: 0.12,
      },
      hard: {
        aimErrorDeg: 3,
        powerErrorRatio: 0.05,
      },
    },
  },
} as const;

export type GameConfig = typeof GAME_CONFIG;

/** SP 难度档位（Phase 10） */
export type AIDifficulty = keyof typeof GAME_CONFIG.ai.difficulties;
