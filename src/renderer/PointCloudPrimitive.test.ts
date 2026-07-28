import { describe, expect, it } from 'vitest';
import { splitPositions } from './PointCloudPrimitive';

// ECEF coordinates are on the order of 1e6~1e7 meters, well beyond what a
// single float32 can represent sub-millimeter precision for.
const ECEF_LIKE = new Float64Array([6378137.1234567, -1234567.891011, 5000000.5]);

describe('splitPositions', () => {
  it('output array length matches the input', () => {
    const { posHigh, posLow } = splitPositions(ECEF_LIKE);

    expect(posHigh.length).toBe(ECEF_LIKE.length);
    expect(posLow.length).toBe(ECEF_LIKE.length);
  });

  it('adding high + low at float32 precision reconstructs the original value almost exactly', () => {
    const { posHigh, posLow } = splitPositions(ECEF_LIKE);

    for (let i = 0; i < ECEF_LIKE.length; i++) {
      const reconstructed = Math.fround(posHigh[i]) + Math.fround(posLow[i]);
      expect(Math.abs(reconstructed - ECEF_LIKE[i])).toBeLessThan(1e-3);
    }
  });

  it('high/low splitting has much less error than a single float32 cast', () => {
    const { posHigh, posLow } = splitPositions(ECEF_LIKE);

    let naiveTotalError = 0;
    let splitTotalError = 0;
    for (let i = 0; i < ECEF_LIKE.length; i++) {
      naiveTotalError += Math.abs(Math.fround(ECEF_LIKE[i]) - ECEF_LIKE[i]);
      splitTotalError += Math.abs(Math.fround(posHigh[i]) + Math.fround(posLow[i]) - ECEF_LIKE[i]);
    }

    expect(splitTotalError).toBeLessThan(naiveTotalError);
  });
});
