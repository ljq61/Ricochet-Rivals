/** Phase 17 first-look assets. Missing files retain the existing playable visuals. */
export const ART = {
  harbor: 'art-harbor',
  aimControls: 'art-aim-controls',
  platform: 'art-dock-platform',
  portraitFrame: 'art-portrait-frame',
  smoke: 'art-smoke',
  tower: 'art-tower',
  P1: 'art-blue',
  P2: 'art-red',
  walkP1: 'art-blue-walk',
  walkP2: 'art-red-walk',
  projectile: 'art-projectile',
  explosion: 'art-explosion',
  /** 真机反馈轮：双方基地（concept01 §05，底部平整甲板=走线） */
  baseP1: 'art-base-p1',
  baseP2: 'art-base-p2',
  /** 真机反馈轮：HUD 头像（concept_UI 玩家卡语言，铆钉框程序绘制） */
  avatarP1: 'art-avatar-p1',
  avatarP2: 'art-avatar-p2',
  /** 真机反馈轮：主菜单 Logo（concept_UI 标题页风格） */
  logo: 'art-logo',
  /** 真机反馈轮：菜单按钮 9-slice 无字底板（金=主操作 / 钢=次要） */
  buttonGold: 'art-button-gold',
  buttonSteel: 'art-button-steel',
  /** 基地受损轮：大小火各 8 帧循环（4×4 sheet，BootScene 运行时切帧） */
  baseFire: 'art-base-fire',
  /** Phase 17 玩法特性：中央章鱼触手 16 帧待机循环（任一方 HP ≤ 4 升起） */
  octopus: 'art-octopus',
} as const;

export const ART_FILES = [
  [ART.harbor, 'harbor.png'],
  [ART.aimControls, 'aim-controls.png'],
  [ART.platform, 'dock-platform-tall.png'],
  [ART.portraitFrame, 'portrait-frame.png'],
  [ART.smoke, 'smoke-puff.png'],
  [ART.tower, 'harbor-tower.png'],
  [ART.P1, 'blue-chibi.png'],
  [ART.P2, 'red-chibi.png'],
  [ART.walkP1, 'blue-walk.png'],
  [ART.walkP2, 'red-walk.png'],
  [ART.projectile, 'normal-projectile.png'],
  [ART.explosion, 'explosion-impact.png'],
  [ART.baseP1, 'base-blue.png'],
  [ART.baseP2, 'base-red.png'],
  [ART.avatarP1, 'avatar-blue.png'],
  [ART.avatarP2, 'avatar-red.png'],
  [ART.logo, 'logo.png'],
  [ART.buttonGold, 'button-gold.png'],
  [ART.buttonSteel, 'button-steel.png'],
  [ART.baseFire, 'base-fire-varied.png'],
  [ART.octopus, 'octopus-flex.png'],
] as const;

/** Long-piling dock, measured alpha bounds; world and menu share the same aspect ratio. */
export const DOCK_ART_FRAME = { x: 17, y: 65, width: 1739, height: 759 } as const;

/**
 * 精灵序列 sheet 网格（4×4 = 16 帧循环动画；帧尺寸 = 源尺寸 ÷ 网格，
 * BootScene create 运行时切帧编号 0…15；当前素材实测 1254² → 313² 帧，边缘余数忽略）
 */
export const SHEET_GRID = { cols: 4, rows: 4 } as const;

/** Opaque top and sole positions measured from the generated 1254px sprites. */
export const PLAYER_ART_BOUNDS = {
  P1: { top: 136, bottom: 1229, sourceHeight: 1254 },
  P2: { top: 65, bottom: 1228, sourceHeight: 1254 },
} as const;

// ---- Phase 17 修复轮：瞄准抬枪序列（15–75°） ------------------------------

export type ArtPlayerKey = 'P1' | 'P2';
export type ArtBounds = { top: number; bottom: number; sourceHeight: number };

/** 姿态角序列（与素材一一对应；<7.5° 回 idle，见 bucketAimPoseAngle） */
export const AIM_POSE_ANGLES = [15, 30, 45, 60, 75] as const;
export type AimPoseAngle = (typeof AIM_POSE_ANGLES)[number];

const POSE_FILE_STEM: Record<ArtPlayerKey, string> = { P1: 'blue', P2: 'red' };

/** 姿态纹理 key（art-blue-aim15 …；BootScene 预加载 / Player 切换共用） */
export function aimPoseKey(player: ArtPlayerKey, angle: AimPoseAngle): string {
  return `${ART[player]}-aim${angle}`;
}

/** 姿态素材清单（BootScene 追加预加载；缺失时运行时自动回退 idle） */
export const AIM_POSE_FILES: ReadonlyArray<readonly [string, string]> =
  AIM_POSE_ANGLES.flatMap((angle) =>
    (['P1', 'P2'] as const).map(
      (player) => [aimPoseKey(player, angle), `${POSE_FILE_STEM[player]}-aim${angle}.png`] as const,
    ),
  );

/**
 * 仰角（0–90°）→ 姿态分桶：<7.5° 回 idle（近水平拖拽不换姿态），
 * 其余取最近姿态角（平局取较小角：22.5 → 15）。纯函数可单测。
 */
export function bucketAimPoseAngle(elevationDeg: number): AimPoseAngle | null {
  if (elevationDeg < 7.5) {
    return null;
  }
  let best: AimPoseAngle = AIM_POSE_ANGLES[0];
  for (const angle of AIM_POSE_ANGLES) {
    if (Math.abs(angle - elevationDeg) < Math.abs(best - elevationDeg)) {
      best = angle;
    }
  }
  return best;
}

/**
 * 姿态素材不透明边界（scripts/measure-art.mjs 实测；bottom 为独占行号，
 * 与 PLAYER_ART_BOUNDS 同口径）。脚底锚点 = bottom/sourceHeight。
 */
export const AIM_POSE_BOUNDS: Record<ArtPlayerKey, Record<AimPoseAngle, ArtBounds>> = {
  P1: {
    15: { top: 99, bottom: 990, sourceHeight: 1024 },
    30: { top: 64, bottom: 994, sourceHeight: 1024 },
    45: { top: 94, bottom: 981, sourceHeight: 1024 },
    60: { top: 105, bottom: 980, sourceHeight: 1024 },
    75: { top: 64, bottom: 988, sourceHeight: 1024 },
  },
  P2: {
    15: { top: 70, bottom: 980, sourceHeight: 1024 },
    30: { top: 51, bottom: 980, sourceHeight: 1024 },
    45: { top: 81, bottom: 978, sourceHeight: 1024 },
    60: { top: 106, bottom: 971, sourceHeight: 1024 },
    75: { top: 13, bottom: 1009, sourceHeight: 1024 },
  },
};

/** 4×2 walk sheets: measured planted soles, fixed scale preserves intentional head bob. */
export const WALK_ART = {
  P1: { key: ART.walkP1, visibleHeight: 420, soles: [436, 435, 435, 436, 431, 431, 430, 431] },
  P2: { key: ART.walkP2, visibleHeight: 416, soles: [431, 429, 436, 435, 425, 425, 429, 424] },
} as const;
