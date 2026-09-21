import { describe, expect, it } from 'vitest';
import { geoPositionToBody, normalizarAccuracyM } from './driver-position.js';

function pos(accuracy: number): GeolocationPosition {
  return {
    timestamp: Date.parse('2026-09-15T12:00:00.000Z'),
    coords: {
      latitude: -33.4372,
      longitude: -70.6506,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
  } as GeolocationPosition;
}

describe('normalizarAccuracyM / geoPositionToBody', () => {
  it('0 / NaN / negativo → null (precisión desconocida, no radio 0)', () => {
    expect(normalizarAccuracyM(0)).toBeNull();
    expect(normalizarAccuracyM(Number.NaN)).toBeNull();
    expect(normalizarAccuracyM(-1)).toBeNull();
    expect(normalizarAccuracyM(null)).toBeNull();
    expect(normalizarAccuracyM(undefined)).toBeNull();
  });

  it('un valor en rango se conserva', () => {
    expect(normalizarAccuracyM(8)).toBe(8);
    expect(normalizarAccuracyM(10_000)).toBe(10_000);
  });

  it('Playwright accuracy 0 → body con accuracy_m null (el API es .positive())', () => {
    expect(geoPositionToBody(pos(0)).accuracy_m).toBeNull();
    expect(geoPositionToBody(pos(12)).accuracy_m).toBe(12);
  });
});
