import { describe, expect, it } from 'vitest';
import { computarEscrituraDistanciaReal } from './calcular-distancia-real.js';
import { clasificarCoberturaCero } from './clasificar-cobertura-cero.js';
import type { PingPoint } from './posicion-segmento.js';

/**
 * BOO-83ND2C: la tarjeta contó 17 POST y el resultado dijo cobertura 0 %.
 * El conteo y el porcentaje no miden lo mismo. Estos casos fijan las dos
 * salidas permitidas: cobertura > 0, o un motivo que no es un cero mudo.
 */

const T0 = Date.parse('2026-09-21T18:00:00Z');

function puntosMoviles(n: number, gapMs: number, pasoLng: number): PingPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    tMs: T0 + i * gapMs,
    lat: -33.4,
    lng: -70.6 - i * pasoLng,
  }));
}

describe('17 puntos del móvil → cobertura > 0 o motivo de cero honesto', () => {
  it('continuos (< 60 s) y con desplazamiento → cobertura > 0, sin motivo de cero', async () => {
    const pings = puntosMoviles(17, 30_000, 0.001);
    const escritura = await computarEscrituraDistanciaReal(pings, () => {
      throw new Error('un tramo continuo no pide Routes');
    });
    expect(escritura).not.toBeNull();
    expect(escritura?.coveragePct).toBeGreaterThan(0);
    expect(escritura?.kmCubiertos).toBeGreaterThan(0);

    const c = clasificarCoberturaCero({
      coveragePct: escritura?.coveragePct ?? 0,
      fuente: 'movil_gps',
      pingsEnTramo: pings,
      puntosTelefono: 17,
    });
    expect(c.motivo).toBeNull();
    expect(c.puntosEnTramo).toBe(17);
  });

  it('17 puntos en el tramo, todos a más de 60 s → cobertura 0 con motivo sin_tramo_continuo', async () => {
    const pings = puntosMoviles(17, 120_000, 0.001);
    const escritura = await computarEscrituraDistanciaReal(pings, async () => 1);
    expect(escritura?.coveragePct).toBe(0);
    expect(escritura?.distanciaKmReal).toBeNull();

    const c = clasificarCoberturaCero({
      coveragePct: 0,
      fuente: 'movil_gps',
      pingsEnTramo: pings,
      puntosTelefono: 17,
    });
    expect(c.motivo).toBe('sin_tramo_continuo');
    expect(c.puntosEnTramo).toBe(17);
  });

  it('17 puntos continuos pero quietos → sin_desplazamiento, no “no llegó nada”', () => {
    const pings = puntosMoviles(17, 25_000, 0);
    const c = clasificarCoberturaCero({
      coveragePct: 0,
      fuente: 'movil_gps',
      pingsEnTramo: pings,
      puntosTelefono: 17,
    });
    expect(c.motivo).toBe('sin_desplazamiento');
    expect(c.puntosEnTramo).toBe(17);
  });

  it('17 POST de la asignación y cero pings en la ventana → fuera_de_tramo', () => {
    const c = clasificarCoberturaCero({
      coveragePct: 0,
      fuente: 'movil_gps',
      pingsEnTramo: [],
      puntosTelefono: 17,
    });
    expect(c.motivo).toBe('fuera_de_tramo');
    expect(c.puntosEnTramo).toBe(0);
  });

  it('dispositivo sin pings en el tramo y 17 puntos de teléfono → sin_telemetria_dispositivo', () => {
    const c = clasificarCoberturaCero({
      coveragePct: 0,
      fuente: 'teltonika_gps',
      pingsEnTramo: [],
      puntosTelefono: 17,
    });
    expect(c.motivo).toBe('sin_telemetria_dispositivo');
  });

  it('ni dispositivo ni teléfono → sin_puntos', () => {
    expect(
      clasificarCoberturaCero({
        coveragePct: 0,
        fuente: 'movil_gps',
        pingsEnTramo: [],
        puntosTelefono: 0,
      }).motivo,
    ).toBe('sin_puntos');
    expect(
      clasificarCoberturaCero({
        coveragePct: 0,
        fuente: 'teltonika_gps',
        pingsEnTramo: [],
        puntosTelefono: 0,
      }).motivo,
    ).toBe('sin_puntos');
  });

  it('había tramo medido pero se persistió 0 → medicion_no_cerrada', () => {
    const pings = puntosMoviles(17, 30_000, 0.001);
    const c = clasificarCoberturaCero({
      coveragePct: 0,
      fuente: 'movil_gps',
      pingsEnTramo: pings,
      puntosTelefono: 17,
    });
    expect(c.motivo).toBe('medicion_no_cerrada');
  });

  it('cobertura ya > 0 no se reexplica', () => {
    const c = clasificarCoberturaCero({
      coveragePct: 12.5,
      fuente: 'movil_gps',
      pingsEnTramo: [],
      puntosTelefono: 17,
    });
    expect(c.motivo).toBeNull();
  });
});
