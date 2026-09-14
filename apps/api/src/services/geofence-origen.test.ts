import { describe, expect, it } from 'vitest';
import { apiEnvSchema } from '../config.js';
import { haversineKm } from './calcular-cobertura-telemetria.js';
import { dentroDelGeofence, evaluarGeofenceOrigen } from './geofence-origen.js';

/**
 * Task 8 (plan medicion-huella-segmento): detector puro de geofence del
 * origen. Contrato: dentro (≤ radio) / fuera (> radio) por haversine; y
 * "origen sin geocodificar" (T4 degrada a NULL en siete escenarios) es una
 * RESPUESTA VÁLIDA — sin geofence, disparo solo por tap — nunca un throw ni
 * coordenadas asumidas.
 */

/** Origen de referencia: Av. Apoquindo (Las Condes), lat/lng reales. */
const ORIGEN = { lat: -33.4188917, lng: -70.6045211 };

/** Radio terrestre que usa `haversineKm` (6371 km), en metros. */
const EARTH_RADIUS_M = 6_371_000;

/** Punto a `metros` al norte del origen sobre el mismo meridiano. */
function alNorte(origen: { lat: number; lng: number }, metros: number) {
  const dLatDeg = (metros / EARTH_RADIUS_M) * (180 / Math.PI);
  return { lat: origen.lat + dLatDeg, lng: origen.lng };
}

describe('evaluarGeofenceOrigen / dentroDelGeofence', () => {
  it('a ~50 m del origen con radio 150 → dentro (distancia informada)', () => {
    const pos = alNorte(ORIGEN, 50);

    const r = evaluarGeofenceOrigen({ pos, origen: ORIGEN, radioM: 150 });

    expect(r.estado).toBe('dentro');
    if (r.estado === 'dentro') {
      expect(r.distanciaM).toBeCloseTo(50, 0);
    }
    expect(dentroDelGeofence({ pos, origen: ORIGEN, radioM: 150 })).toBe(true);
  });

  it('a ~500 m del origen con radio 150 → fuera (distancia informada)', () => {
    const pos = alNorte(ORIGEN, 500);

    const r = evaluarGeofenceOrigen({ pos, origen: ORIGEN, radioM: 150 });

    expect(r.estado).toBe('fuera');
    if (r.estado === 'fuera') {
      expect(r.distanciaM).toBeCloseTo(500, 0);
    }
    expect(dentroDelGeofence({ pos, origen: ORIGEN, radioM: 150 })).toBe(false);
  });

  it('exactamente en el borde (distancia == radio) → dentro: el borde es inclusivo (≤)', () => {
    const pos = alNorte(ORIGEN, 150);
    // Radio fijado a la distancia EXACTA que calcula haversine para ese punto,
    // así el test prueba la semántica ≤ y no el ruido de coma flotante.
    const radioExactoM = haversineKm(ORIGEN.lat, ORIGEN.lng, pos.lat, pos.lng) * 1000;
    expect(radioExactoM).toBeCloseTo(150, 3);

    expect(dentroDelGeofence({ pos, origen: ORIGEN, radioM: radioExactoM })).toBe(true);
    // Un milímetro menos de radio y ya queda fuera → el borde no es "<".
    expect(dentroDelGeofence({ pos, origen: ORIGEN, radioM: radioExactoM - 0.001 })).toBe(false);
  });

  it('origen NULL (viaje sin geocodificar) → sin_origen: respuesta válida, sin geofence, no lanza', () => {
    const pos = alNorte(ORIGEN, 10);

    expect(() => evaluarGeofenceOrigen({ pos, origen: null, radioM: 150 })).not.toThrow();
    expect(evaluarGeofenceOrigen({ pos, origen: null, radioM: 150 })).toEqual({
      estado: 'sin_origen',
    });
    // Sin origen jamás se sugiere recogida por geofence: el disparo queda solo por tap.
    expect(dentroDelGeofence({ pos, origen: null, radioM: 150 })).toBe(false);
  });

  it('origen con coordenadas inválidas (null island 0,0 o NaN) → sin_origen, nunca "fuera"', () => {
    const pos = alNorte(ORIGEN, 10);

    expect(evaluarGeofenceOrigen({ pos, origen: { lat: 0, lng: 0 }, radioM: 150 })).toEqual({
      estado: 'sin_origen',
    });
    expect(
      evaluarGeofenceOrigen({ pos, origen: { lat: Number.NaN, lng: -70.6 }, radioM: 150 }),
    ).toEqual({ estado: 'sin_origen' });
  });

  it('posición del conductor ausente o inválida → sin_posicion (no se asume dónde está)', () => {
    expect(evaluarGeofenceOrigen({ pos: null, origen: ORIGEN, radioM: 150 })).toEqual({
      estado: 'sin_posicion',
    });
    expect(evaluarGeofenceOrigen({ pos: { lat: 0, lng: 0 }, origen: ORIGEN, radioM: 150 })).toEqual(
      { estado: 'sin_posicion' },
    );
    expect(dentroDelGeofence({ pos: null, origen: ORIGEN, radioM: 150 })).toBe(false);
  });
});

describe('GEOFENCE_RADIUS_M (config)', () => {
  // process.env trae los requeridos del apiEnvSchema (test/setup.ts); acá solo
  // se controla GEOFENCE_RADIUS_M. `apiEnvSchema` termina en superRefine
  // (ZodEffects, sin `.shape`), por eso se parsea el env completo.
  function envWith(radius: string | undefined): NodeJS.ProcessEnv {
    const { GEOFENCE_RADIUS_M: _omit, ...rest } = process.env;
    return radius === undefined ? rest : { ...rest, GEOFENCE_RADIUS_M: radius };
  }

  it('default 150 m cuando la env var no está', () => {
    const parsed = apiEnvSchema.safeParse(envWith(undefined));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.GEOFENCE_RADIUS_M).toBe(150);
    }
  });

  it('coerciona el string de la env var a entero positivo', () => {
    const parsed = apiEnvSchema.safeParse(envWith('200'));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.GEOFENCE_RADIUS_M).toBe(200);
    }
  });

  it('rechaza cero, negativos y no numéricos', () => {
    expect(apiEnvSchema.safeParse(envWith('0')).success).toBe(false);
    expect(apiEnvSchema.safeParse(envWith('-5')).success).toBe(false);
    expect(apiEnvSchema.safeParse(envWith('abc')).success).toBe(false);
  });
});
