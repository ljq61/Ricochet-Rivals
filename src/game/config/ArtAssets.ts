/** Phase 17 first-look assets. Missing files retain the existing playable visuals. */
export const ART = {
  harbor: 'art-harbor',
  tower: 'art-tower',
  P1: 'art-blue',
  P2: 'art-red',
  projectile: 'art-projectile',
  explosion: 'art-explosion',
} as const;

export const ART_FILES = [
  [ART.harbor, 'harbor.png'],
  [ART.tower, 'harbor-tower.png'],
  [ART.P1, 'blue-chibi.png'],
  [ART.P2, 'red-chibi.png'],
  [ART.projectile, 'normal-projectile.png'],
  [ART.explosion, 'explosion-impact.png'],
] as const;

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
