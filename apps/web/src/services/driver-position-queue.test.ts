import { describe, expect, it } from 'vitest';
import {
  ColaPosiciones,
  type PuntoEnCola,
  decidirReporte,
  distanciaHaversineM,
} from './driver-position-queue.js';

const T0 = Date.parse('2026-09-15T12:00:00.000Z');
const OPTS = { minIntervalMs: 10_000, minDistanceM: 10, heartbeatMs: 25_000 };

function punto(lat: number, lng: number, tMs: number): PuntoEnCola {
  return { timestamp_device: new Date(tMs).toISOString(), latitude: lat, longitude: lng };
}

/** localStorage de mentira, para probar persistencia entre instancias. */
function almacen() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('decidirReporte — throttle por tiempo Y distancia, con latido', () => {
  // La cobertura (CONTINUITY_GAP_S = 60) exige < 60 s entre pings: el latido
  // de 25 s garantiza tramo cubierto aunque el camión esté detenido.
  it('sin punto anterior → enviar', () => {
    expect(decidirReporte(null, punto(-33.4, -70.6, T0), OPTS)).toBe('enviar');
  });
  it('5 s y 50 m → omitir (aún no pasa el mínimo de tiempo)', () => {
    const prev = punto(-33.4, -70.6, T0);
    expect(decidirReporte(prev, punto(-33.40045, -70.6, T0 + 5_000), OPTS)).toBe('omitir');
  });
  it('15 s y 3 m → omitir (no se movió lo suficiente)', () => {
    const prev = punto(-33.4, -70.6, T0);
    expect(decidirReporte(prev, punto(-33.400027, -70.6, T0 + 15_000), OPTS)).toBe('omitir');
  });
  it('15 s y 20 m → enviar', () => {
    const prev = punto(-33.4, -70.6, T0);
    expect(decidirReporte(prev, punto(-33.40018, -70.6, T0 + 15_000), OPTS)).toBe('enviar');
  });
  it('26 s sin moverse → enviar (latido, salta la regla de distancia)', () => {
    const prev = punto(-33.4, -70.6, T0);
    expect(decidirReporte(prev, punto(-33.4, -70.6, T0 + 26_000), OPTS)).toBe('enviar');
  });
  it('haversine: 1 grado de latitud ≈ 111 km', () => {
    expect(distanciaHaversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('ColaPosiciones — FIFO persistida por asignación', () => {
  it('encolar persiste: otra instancia con el mismo almacén ve los puntos', () => {
    const st = almacen();
    const a = new ColaPosiciones('asg-1', { almacen: st, tope: 10 });
    a.encolar(punto(-33.4, -70.6, T0));
    a.encolar(punto(-33.41, -70.6, T0 + 30_000));
    const b = new ColaPosiciones('asg-1', { almacen: st, tope: 10 });
    expect(b.pendientes()).toBe(2);
    expect(new ColaPosiciones('asg-2', { almacen: st, tope: 10 }).pendientes()).toBe(0);
  });

  it('tope: al superarlo se descarta el más viejo', () => {
    const q = new ColaPosiciones('asg-1', { almacen: almacen(), tope: 3 });
    for (let i = 0; i < 5; i++) {
      q.encolar(punto(-33.4, -70.6, T0 + i * 30_000));
    }
    expect(q.pendientes()).toBe(3);
    expect(q.primero()?.timestamp_device).toBe(new Date(T0 + 2 * 30_000).toISOString());
  });

  it('drenar manda en orden y se detiene en el primer fallo conservando el resto', async () => {
    const q = new ColaPosiciones('asg-1', { almacen: almacen(), tope: 10 });
    for (let i = 0; i < 3; i++) {
      q.encolar(punto(-33.4, -70.6, T0 + i * 30_000));
    }
    const enviados: string[] = [];
    const r = await q.drenar(async (p) => {
      if (enviados.length === 1) {
        throw new TypeError('Failed to fetch');
      }
      enviados.push(p.timestamp_device);
      return { ok: true };
    });
    expect(enviados).toEqual([new Date(T0).toISOString()]);
    expect(r).toEqual({ enviados: 1, restantes: 2, detenido: 'fallo' });
    expect(q.pendientes()).toBe(2);
    expect(q.primero()?.timestamp_device).toBe(new Date(T0 + 30_000).toISOString());
  });

  it('409 assignment_not_active vacía la cola (la asignación ya cerró)', async () => {
    const q = new ColaPosiciones('asg-1', { almacen: almacen(), tope: 10 });
    q.encolar(punto(-33.4, -70.6, T0));
    q.encolar(punto(-33.4, -70.6, T0 + 30_000));
    const r = await q.drenar(async () => {
      throw Object.assign(new Error('409'), { status: 409, code: 'assignment_not_active' });
    });
    expect(r).toEqual({ enviados: 0, restantes: 0, detenido: 'asignacion_cerrada' });
    expect(q.pendientes()).toBe(0);
  });

  it('almacén roto (Safari privado): la cola sigue en memoria sin lanzar', () => {
    const roto = {
      getItem: () => {
        throw new Error('QuotaExceededError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const q = new ColaPosiciones('asg-1', { almacen: roto, tope: 10 });
    expect(() => q.encolar(punto(-33.4, -70.6, T0))).not.toThrow();
    expect(q.pendientes()).toBe(1);
  });
});
