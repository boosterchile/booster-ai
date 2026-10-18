import { describe, expect, it } from 'vitest';
import { haversineKm } from '../services/calcular-cobertura-telemetria.js';
import {
  type LecturaSegmentoCan,
  MOTIVOS_CONSUMO_CAN_NO_USADO,
  consumoCanSegmento,
} from './consumo-can-segmento.js';

/**
 * T10-05 (ADR-077 §2) — litros medidos por el IO 83 en el segmento del viaje.
 * Es la entrada del modo `exacto_canbus`: un número malo aquí certificaría como
 * primario, por eso cada motivo de descarte tiene su caso.
 */

// 0,01° de latitud ≈ 1,11 km. `n` puntos hacia el norte desde Santiago.
function trayecto(n: number, litrosPorPunto: number | null, litrosIniciales = 1000) {
  const lecturas: LecturaSegmentoCan[] = [];
  for (let i = 0; i < n; i++) {
    lecturas.push({
      tMs: i * 60_000,
      lat: -33.4 + i * 0.01,
      lng: -70.6,
      io:
        litrosPorPunto === null
          ? {}
          : { '83': Math.round((litrosIniciales + i * litrosPorPunto) * 10) },
    });
  }
  return lecturas;
}

function distanciaDe(lecturas: LecturaSegmentoCan[]): number {
  let km = 0;
  for (let i = 1; i < lecturas.length; i++) {
    const a = lecturas[i - 1];
    const b = lecturas[i];
    if (a && b) {
      km += haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
  }
  return km;
}

describe('consumoCanSegmento', () => {
  it('Δ del contador 83 (×0,1 L) en un segmento cubierto → litros', () => {
    // 21 puntos ≈ 22 km, 0,4 L por punto → 8 L (≈ 36 L/100 km).
    const lecturas = trayecto(21, 0.4);
    const r = consumoCanSegmento({ lecturas, distanciaSegmentoKm: distanciaDe(lecturas) });
    expect(r).toEqual({ litros: 8 });
  });

  it('menos de 2 lecturas del 83 → sin_lecturas', () => {
    const lecturas = trayecto(21, null);
    const unaSola = trayecto(1, 0.4);
    expect(consumoCanSegmento({ lecturas, distanciaSegmentoKm: 22 })).toEqual({
      litros: null,
      motivo: 'sin_lecturas',
    });
    expect(consumoCanSegmento({ lecturas: unaSola, distanciaSegmentoKm: 22 }).litros).toBeNull();
  });

  it('IO 83 fuera del rango del catálogo no cuenta como lectura', () => {
    const lecturas = trayecto(21, 0.4).map((l) => ({ ...l, io: { '83': -5 } }));
    expect(consumoCanSegmento({ lecturas, distanciaSegmentoKm: 22 })).toEqual({
      litros: null,
      motivo: 'sin_lecturas',
    });
  });

  it('contador que retrocede (reinicio del equipo) → contador_retrocedio', () => {
    const lecturas = trayecto(21, -0.4);
    const r = consumoCanSegmento({ lecturas, distanciaSegmentoKm: distanciaDe(lecturas) });
    expect(r).toEqual({ litros: null, motivo: 'contador_retrocedio' });
  });

  it('contador quieto → contador_sin_avance', () => {
    const lecturas = trayecto(21, 0);
    const r = consumoCanSegmento({ lecturas, distanciaSegmentoKm: distanciaDe(lecturas) });
    expect(r).toEqual({ litros: null, motivo: 'contador_sin_avance' });
  });

  it('lecturas que cubren menos del 95 % del segmento → cobertura_insuficiente', () => {
    // El 83 solo llega en la primera mitad del recorrido.
    const lecturas = trayecto(21, 0.8).map((l, i) => (i > 10 ? { ...l, io: {} } : l));
    const r = consumoCanSegmento({ lecturas, distanciaSegmentoKm: distanciaDe(lecturas) });
    expect(r).toEqual({ litros: null, motivo: 'cobertura_insuficiente' });
  });

  it('menos de 5 L o menos de 10 km → muestra_insuficiente', () => {
    const pocosLitros = trayecto(21, 0.2); // 4 L en 22 km
    const pocosKm = trayecto(6, 1.5); // 7,5 L en 5,6 km
    expect(
      consumoCanSegmento({ lecturas: pocosLitros, distanciaSegmentoKm: distanciaDe(pocosLitros) }),
    ).toEqual({ litros: null, motivo: 'muestra_insuficiente' });
    expect(
      consumoCanSegmento({ lecturas: pocosKm, distanciaSegmentoKm: distanciaDe(pocosKm) }),
    ).toEqual({ litros: null, motivo: 'muestra_insuficiente' });
  });

  it('consumo fuera de [3, 100] L/100 km → consumo_implausible', () => {
    const exceso = trayecto(21, 2); // 40 L en 22 km ≈ 180 L/100 km
    const casiNada = trayecto(201, 0.025, 1000); // 5 L en ≈ 222 km ≈ 2,2 L/100 km
    expect(
      consumoCanSegmento({ lecturas: exceso, distanciaSegmentoKm: distanciaDe(exceso) }),
    ).toEqual({ litros: null, motivo: 'consumo_implausible' });
    expect(
      consumoCanSegmento({ lecturas: casiNada, distanciaSegmentoKm: distanciaDe(casiNada) }),
    ).toEqual({ litros: null, motivo: 'consumo_implausible' });
  });

  it('lecturas desordenadas se evalúan por tiempo de dispositivo', () => {
    const lecturas = trayecto(21, 0.4).reverse();
    const r = consumoCanSegmento({ lecturas, distanciaSegmentoKm: distanciaDe(lecturas) });
    expect(r).toEqual({ litros: 8 });
  });

  it('expone los motivos como contrato de la métrica', () => {
    expect([...MOTIVOS_CONSUMO_CAN_NO_USADO].sort()).toEqual(
      [
        'cobertura_insuficiente',
        'consumo_implausible',
        'contador_retrocedio',
        'contador_sin_avance',
        'muestra_insuficiente',
        'sin_lecturas',
      ].sort(),
    );
  });
});
