import { describe, expect, it } from 'vitest';
import { type MuestraPosicion, detectarCongestion } from './detectar-congestion.js';

const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);
const BASE = { lat: -33.45, lng: -70.66 };

/** Serie cada `pasoS` segundos desde T0 con las velocidades dadas. */
function serie(
  velocidades: (number | null)[],
  pasoS = 10,
  desplazamientoGrados = 0,
): MuestraPosicion[] {
  return velocidades.map((v, i) => ({
    tsMs: T0 + i * pasoS * 1000,
    velocidadKmh: v,
    lat: BASE.lat + i * desplazamientoGrados,
    lng: BASE.lng,
  }));
}

const ahoraTras = (m: MuestraPosicion[]) => (m[m.length - 1]?.tsMs ?? T0) + 1000;

describe('detectarCongestion — ADR-012 Capa 1: < 10 km/h sostenido > 60 s', () => {
  it('detecta cuando la velocidad está bajo 10 km/h por más de 60 s', () => {
    const m = serie([40, 8, 5, 3, 6, 4, 7, 5]); // lentas desde t=10s hasta t=70s → 60 s
    const r = detectarCongestion(m, { ahoraMs: ahoraTras(m) });
    expect(r.congestion).toBe(true);
    if (r.congestion) {
      expect(r.desdeMs).toBe(T0 + 10_000);
      expect(r.duracionSegundos).toBe(60);
      expect(r.velocidadMediaKmh).toBeCloseTo(5.43, 1);
      expect(r.posicion).toEqual({ lat: BASE.lat, lng: BASE.lng });
    }
  });

  it('no detecta con 50 s lentos (ventana incompleta)', () => {
    const m = serie([40, 8, 5, 3, 6, 4, 7]);
    expect(detectarCongestion(m, { ahoraMs: ahoraTras(m) })).toEqual({
      congestion: false,
      razon: 'ventana_incompleta',
    });
  });

  it('no detecta si el vehículo va en movimiento', () => {
    const m = serie([40, 50, 45, 30, 60, 55, 50, 48]);
    expect(detectarCongestion(m, { ahoraMs: ahoraTras(m) })).toEqual({
      congestion: false,
      razon: 'en_movimiento',
    });
  });

  it('una muestra rápida en medio corta la racha', () => {
    const m = serie([5, 5, 5, 30, 5, 5, 5, 5]);
    expect(detectarCongestion(m, { ahoraMs: ahoraTras(m) })).toMatchObject({
      congestion: false,
      razon: 'ventana_incompleta',
    });
  });

  it('un hueco mayor a maxGapSegundos corta la racha', () => {
    const m = serie([5, 5, 5, 5, 5, 5, 5, 5]);
    // hueco de 40 s entre la 4.ª y 5.ª muestra
    const conHueco = m.map((x, i) => (i >= 4 ? { ...x, tsMs: x.tsMs + 30_000 } : x));
    expect(detectarCongestion(conHueco, { ahoraMs: ahoraTras(conHueco) })).toMatchObject({
      congestion: false,
      razon: 'ventana_incompleta',
    });
  });

  it('datos obsoletos: la última muestra es más vieja que maxGapSegundos', () => {
    const m = serie([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(detectarCongestion(m, { ahoraMs: ahoraTras(m) + 60_000 })).toEqual({
      congestion: false,
      razon: 'datos_obsoletos',
    });
  });

  it('sin muestras', () => {
    expect(detectarCongestion([], { ahoraMs: T0 })).toEqual({
      congestion: false,
      razon: 'sin_datos',
    });
  });

  it('ignora el orden de llegada (ordena por timestamp)', () => {
    const m = serie([40, 8, 5, 3, 6, 4, 7, 5]).reverse();
    expect(detectarCongestion(m, { ahoraMs: T0 + 71_000 }).congestion).toBe(true);
  });

  it('velocidad nula: la deriva del desplazamiento entre muestras', () => {
    // 0.0001° de latitud ≈ 11 m cada 10 s ≈ 4 km/h → lento
    const lento = serie([null, null, null, null, null, null, null, null], 10, 0.0001);
    expect(detectarCongestion(lento, { ahoraMs: ahoraTras(lento) }).congestion).toBe(true);
    // 0.003° ≈ 333 m cada 10 s ≈ 120 km/h → en movimiento
    const rapido = serie([null, null, null, null, null, null, null, null], 10, 0.003);
    expect(detectarCongestion(rapido, { ahoraMs: ahoraTras(rapido) })).toMatchObject({
      congestion: false,
    });
  });

  it('no alerta dentro del radio de una zona excluida (origen/destino: carga y descarga)', () => {
    const m = serie([40, 8, 5, 3, 6, 4, 7, 5]);
    const r = detectarCongestion(m, {
      ahoraMs: ahoraTras(m),
      zonasExcluidas: [{ lat: BASE.lat + 0.001, lng: BASE.lng }], // ~111 m
    });
    expect(r).toEqual({ congestion: false, razon: 'zona_excluida' });
  });

  it('fuera del radio de la zona excluida sí detecta', () => {
    const m = serie([40, 8, 5, 3, 6, 4, 7, 5]);
    const r = detectarCongestion(m, {
      ahoraMs: ahoraTras(m),
      zonasExcluidas: [{ lat: BASE.lat + 0.01, lng: BASE.lng }], // ~1,1 km
    });
    expect(r.congestion).toBe(true);
  });

  it('acepta umbrales configurables', () => {
    const m = serie([40, 14, 13, 12, 14, 13, 12, 14]);
    expect(detectarCongestion(m, { ahoraMs: ahoraTras(m) }).congestion).toBe(false);
    expect(
      detectarCongestion(m, { ahoraMs: ahoraTras(m), config: { umbralKmh: 15 } }).congestion,
    ).toBe(true);
  });
});
