import { describe, expect, it } from 'vitest';
import { connectionQuality } from '../../src/game/ui/connectionQuality';

describe('opponent connection quality', () => {
  it.each([null, NaN, Infinity, -1])('keeps unavailable latency neutral (%s)', (rtt) => {
    expect(connectionQuality(rtt).bars).toBe(0);
    expect(connectionQuality(rtt).label).toBe('CHECKING');
  });

  it('changes signal bars at round-trip latency boundaries', () => {
    expect([0, 99, 100, 199, 200, 399, 400, 1500].map((rtt) => connectionQuality(rtt).bars))
      .toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
    expect(new Set([0, 100, 200, 400].map((rtt) => connectionQuality(rtt).color)).size).toBe(4);
  });
});
