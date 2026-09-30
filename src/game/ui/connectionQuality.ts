export interface ConnectionQuality {
  bars: number;
  color: number;
  label: string;
}

/** Round-trip latency of the opponent DataChannel, independent of matchmaking. */
export function connectionQuality(rttMs: number | null): ConnectionQuality {
  if (rttMs === null || !Number.isFinite(rttMs) || rttMs < 0) {
    return { bars: 0, color: 0x8fa3c7, label: 'CHECKING' };
  }
  if (rttMs < 100) return { bars: 4, color: 0x6de3ad, label: 'EXCELLENT' };
  if (rttMs < 200) return { bars: 3, color: 0xffd568, label: 'GOOD' };
  if (rttMs < 400) return { bars: 2, color: 0xffa65b, label: 'SLOW' };
  return { bars: 1, color: 0xff6b7b, label: 'HIGH LATENCY' };
}
