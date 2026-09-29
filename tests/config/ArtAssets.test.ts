import { describe, expect, it } from 'vitest';
import {
  AIM_POSE_ANGLES,
  AIM_POSE_FILES,
  aimPoseKey,
  bucketAimPoseAngle,
} from '../../src/game/config/ArtAssets';

/**
 * Phase 17 修复轮 —— 瞄准抬枪姿态分桶（纯函数）。
 *
 * 仰角（0–90°）→ null（idle，近水平）/ 最近姿态角（15/30/45/60/75）。
 * 平局取较小角（22.5° → 15°）。
 */
describe('Phase 17 — 瞄准姿态分桶（bucketAimPoseAngle）', () => {
  it('近水平仰角回 idle（<7.5°）', () => {
    expect(bucketAimPoseAngle(0)).toBeNull();
    expect(bucketAimPoseAngle(7.49)).toBeNull();
  });

  it('各仰角取最近姿态角（平局取较小角）', () => {
    expect(bucketAimPoseAngle(7.5)).toBe(15);
    expect(bucketAimPoseAngle(22.4)).toBe(15);
    expect(bucketAimPoseAngle(22.5)).toBe(15);
    expect(bucketAimPoseAngle(37.5)).toBe(30);
    expect(bucketAimPoseAngle(52.5)).toBe(45);
    expect(bucketAimPoseAngle(67.5)).toBe(60);
    expect(bucketAimPoseAngle(89)).toBe(75);
  });

  it('姿态素材清单一一对应（蓝红 × 5 角度）', () => {
    expect(AIM_POSE_FILES).toHaveLength(10);
    for (const angle of AIM_POSE_ANGLES) {
      expect(AIM_POSE_FILES).toContainEqual([
        aimPoseKey('P1', angle),
        `blue-aim${angle}.png`,
      ]);
      expect(AIM_POSE_FILES).toContainEqual([
        aimPoseKey('P2', angle),
        `red-aim${angle}.png`,
      ]);
    }
  });
});
