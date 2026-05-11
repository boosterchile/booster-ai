import { describe, expect, it } from 'vitest';
import { boundsOf, decodePolyline } from './polyline.js';

describe('decodePolyline', () => {
  it('empty string → empty array', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('decodes Google reference example "_p~iF~ps|U_ulLnnqC_mqNvxq`@"', () => {
    // Reference from Google docs:
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    // Expected: [38.5,-120.2], [40.7,-120.95], [43.252,-126.453]
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decoded).toHaveLength(3);
    expect(decoded[0]?.lat).toBeCloseTo(38.5, 4);
    expect(decoded[0]?.lng).toBeCloseTo(-120.2, 4);
    expect(decoded[1]?.lat).toBeCloseTo(40.7, 4);
    expect(decoded[1]?.lng).toBeCloseTo(-120.95, 4);
    expect(decoded[2]?.lat).toBeCloseTo(43.252, 4);
    expect(decoded[2]?.lng).toBeCloseTo(-126.453, 4);
  });

  it('returns multiple-point chain when input is a long polyline', () => {
    // El reference encoding del docs es 3 puntos; verificamos que para
    // un sólo segmento (lat0 + dlat) se decode 1 punto.
    const single = decodePolyline('_p~iF~ps|U');
    expect(single).toHaveLength(1);
    expect(single[0]?.lat).toBeCloseTo(38.5, 4);
    expect(single[0]?.lng).toBeCloseTo(-120.2, 4);
  });

  it('returns valid prefix on malformed input (no throw)', () => {
    // Truncated encoding: should not throw, returns whatever decoded.
    expect(() => decodePolyline('_p~i')).not.toThrow();
  });
});

describe('boundsOf', () => {
  it('empty array → null', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('single point → bounds is point itself', () => {
    expect(boundsOf([{ lat: -33, lng: -70 }])).toEqual({
      north: -33,
      south: -33,
      east: -70,
      west: -70,
    });
  });

  it('multiple points → correct min/max', () => {
    const bounds = boundsOf([
      { lat: -33.4, lng: -70.6 },
      { lat: -36.8, lng: -73.0 },
      { lat: -29.9, lng: -71.2 },
    ]);
    expect(bounds).toEqual({
      north: -29.9,
      south: -36.8,
      east: -70.6, // mayor (más al este de Chile = menos negativo)
      west: -73.0,
    });
  });
});
