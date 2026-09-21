import { describe, expect, it } from 'vitest';
import {
  geoPositionToBody,
  normalizarAccuracyM,
  normalizarHeadingDeg,
  normalizarSpeedKmh,
} from './driver-position.js';

function pos(
  accuracy: number,
  speed: number | null = null,
  heading: number | null = null,
): GeolocationPosition {
  return {
    timestamp: Date.parse('2026-09-15T12:00:00.000Z'),
    coords: {
      latitude: -33.4372,
      longitude: -70.6506,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading,
      speed,
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

  it('speed -1 m/s y heading -1 no viajan: si no, el API responde 400 y la coordenada se pierde', () => {
    expect(normalizarSpeedKmh(-3.6)).toBeNull();
    expect(normalizarSpeedKmh(301)).toBeNull();
    expect(normalizarHeadingDeg(-1)).toBeNull();
    expect(normalizarHeadingDeg(361)).toBeNull();
    const body = geoPositionToBody(pos(8, -1, -1));
    expect(body.latitude).toBe(-33.4372);
    expect(body.longitude).toBe(-70.6506);
    expect(body.speed_kmh).toBeNull();
    expect(body.heading_deg).toBeNull();
  });

  it('8.0611 m/s se redondea a 29.02 km/h y el rumbo en rango se conserva', () => {
    const body = geoPositionToBody(pos(8, 29.02 / 3.6, 180.2));
    expect(body.speed_kmh).toBe(29.02);
    expect(body.heading_deg).toBe(180);
  });
});
