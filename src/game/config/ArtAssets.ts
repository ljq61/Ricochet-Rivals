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
