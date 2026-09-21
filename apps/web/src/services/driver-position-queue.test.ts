import { describe, expect, it } from 'vitest';
import {
  ColaPosiciones,
  type PuntoEnCola,
  decidirReporte,
  distanciaHaversineM,
  esPuntoEnviable,
  esRechazoPermanente,
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
    expect(r).toEqual({ enviados: 1, restantes: 2, descartados: 0, detenido: 'fallo' });
    expect(q.pendientes()).toBe(2);
    expect(q.primero()?.timestamp_device).toBe(new Date(T0 + 30_000).toISOString());
  });

  it('encolar no persiste un punto con accuracy_m > 10 km', () => {
    const st = almacen();
    const q = new ColaPosiciones('asg-1', { almacen: st, tope: 10 });
    q.encolar({
      ...punto(39.95, -75.3, T0),
      accuracy_m: 4_700_000,
    });
    q.encolar({ ...punto(-33.047, -71.613, T0 + 15_000), accuracy_m: 12 });
    expect(q.pendientes()).toBe(1);
    expect(q.primero()?.latitude).toBeCloseTo(-33.047);
    expect(st.getItem('booster.posiciones.asg-1')).not.toContain('4700000');
  });

  // BOO-KJHITL (2026-09-21): la cabeza grosera ya estaba persistida; el 400
  // del API no puede congelar los Valparaíso que vienen detrás.
  it('drenar descarta la cabeza con accuracy_m inválida y envía los puntos válidos', async () => {
    const st = almacen();
    st.setItem(
      'booster.posiciones.asg-1',
      JSON.stringify([
        { ...punto(39.95, -75.3, T0), accuracy_m: 4_700_000 },
        { ...punto(-33.047, -71.613, T0 + 15_000), accuracy_m: 12 },
        { ...punto(-33.048, -71.614, T0 + 30_000), accuracy_m: 8 },
      ]),
    );
    const q = new ColaPosiciones('asg-1', { almacen: st, tope: 10 });
    const enviados: number[] = [];
    const r = await q.drenar(async (p) => {
      enviados.push(p.latitude);
      return { ok: true };
    });
    expect(enviados).toEqual([-33.047, -33.048]);
    expect(r).toEqual({ enviados: 2, restantes: 0, descartados: 1, detenido: null });
    expect(q.pendientes()).toBe(0);
  });

  it('drenar: 400 en la cabeza no bloquea los puntos válidos de detrás', async () => {
    const q = new ColaPosiciones('asg-1', { almacen: almacen(), tope: 10 });
    q.encolar({ ...punto(-33.047, -71.613, T0), accuracy_m: 12 });
    q.encolar({ ...punto(-33.048, -71.614, T0 + 15_000), accuracy_m: 8 });
    const enviados: string[] = [];
    let intentos = 0;
    const r = await q.drenar(async (p) => {
      intentos += 1;
      if (intentos === 1) {
        throw Object.assign(new Error('validation'), { status: 400 });
      }
      enviados.push(p.timestamp_device);
      return { ok: true };
    });
    expect(enviados).toEqual([new Date(T0 + 15_000).toISOString()]);
    expect(r).toEqual({ enviados: 1, restantes: 0, descartados: 1, detenido: null });
    expect(q.pendientes()).toBe(0);
  });

  it('drenar: un fallo de red sigue deteniendo y conserva la cabeza', async () => {
    const q = new ColaPosiciones('asg-1', { almacen: almacen(), tope: 10 });
    q.encolar(punto(-33.4, -70.6, T0));
    q.encolar(punto(-33.41, -70.6, T0 + 30_000));
    const r = await q.drenar(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(r).toEqual({ enviados: 0, restantes: 2, descartados: 0, detenido: 'fallo' });
    expect(q.pendientes()).toBe(2);
  });

  it('esPuntoEnviable / esRechazoPermanente', () => {
    expect(esPuntoEnviable(punto(-33.04, -71.61, T0))).toBe(true);
    expect(esPuntoEnviable({ ...punto(-33.04, -71.61, T0), accuracy_m: 12 })).toBe(true);
    expect(esPuntoEnviable({ ...punto(39.95, -75.3, T0), accuracy_m: 4_700_000 })).toBe(false);
    expect(esPuntoEnviable({ ...punto(-33.04, -71.61, T0), accuracy_m: 0 })).toBe(false);
    expect(esPuntoEnviable({ ...punto(91, -71.61, T0), accuracy_m: 8 })).toBe(false);
    expect(esRechazoPermanente({ status: 400 })).toBe(true);
    expect(esRechazoPermanente({ status: 422 })).toBe(true);
    expect(esRechazoPermanente({ status: 409, code: 'assignment_not_active' })).toBe(false);
    expect(esRechazoPermanente({ status: 401 })).toBe(false);
    expect(esRechazoPermanente({ status: 503 })).toBe(false);
    expect(esRechazoPermanente(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('409 assignment_not_active vacía la cola (la asignación ya cerró)', async () => {
    const q = new ColaPosiciones('asg-1', { almacen: almacen(), tope: 10 });
    q.encolar(punto(-33.4, -70.6, T0));
    q.encolar(punto(-33.4, -70.6, T0 + 30_000));
    const r = await q.drenar(async () => {
      throw Object.assign(new Error('409'), { status: 409, code: 'assignment_not_active' });
    });
    expect(r).toEqual({
      enviados: 0,
      restantes: 0,
      descartados: 0,
      detenido: 'asignacion_cerrada',
    });
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
