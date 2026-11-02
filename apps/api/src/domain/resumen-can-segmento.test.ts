import { describe, expect, it } from 'vitest';
import {
  type LecturaSegmentoCan,
  consumoCanSegmento,
  distanciaRecorrida,
  filasConLectura83,
  soloLecturas83,
} from './consumo-can-segmento.js';
import { decidirFuenteHuella } from './decidir-fuente-huella.js';
import { resumirCanSegmento } from './resumen-can-segmento.js';

// Sintético: puntos en línea recta, 83 en litros (raw ×10) y 89 en %.
const tramo = (l83: (number | null)[], p89: (number | null)[] = []): LecturaSegmentoCan[] =>
  l83.map((l, i) => {
    const io: Record<string, number> = {};
    if (l !== null) {
      io['83'] = l * 10;
    }
    const p = p89[i];
    if (p != null) {
      io['89'] = p;
    }
    return { tMs: i * 60_000, lat: -33 - i * 0.01, lng: -70.6, io };
  });

describe('resumirCanSegmento (HC-001 parte 2)', () => {
  it('83 limpio → Resumen83 con Δ, salto máx y cobertura sobre la distancia', () => {
    const l = tramo([1000, 1010, 1020, 1030, 1040]);
    const km = distanciaRecorrida(l);
    const { can83 } = resumirCanSegmento(l, km * 2, null);
    expect(can83).toEqual({
      lecturas: 5,
      coberturaKmPct: expect.closeTo(50, 6),
      pasosNegativos: 0,
      saltoMaxPorPasoL: expect.closeTo(10, 6),
      litros: expect.closeTo(40, 6),
    });
  });

  it('reset del contador cuenta un paso negativo', () => {
    const { can83 } = resumirCanSegmento(tramo([100, 110, 5, 15]), 10, null);
    expect(can83).toMatchObject({ pasosNegativos: 1, saltoMaxPorPasoL: expect.closeTo(10, 6) });
  });

  it('sin 83 → can83 null; lecturas sueltas sin 83 no cuentan', () => {
    expect(resumirCanSegmento(tramo([null, null]), 10, null).can83).toBeNull();
    expect(resumirCanSegmento(tramo([null, 100, null]), 10, null).can83).toMatchObject({
      lecturas: 1,
    });
  });

  // cap 100 → litros = puntos de caída. Escalones: la mediana de 3 conserva el salto.
  it.each([
    ['glitch de 1 muestra filtrado', [80, 79, 78, 20, 77, 76], 600, 18],
    [
      'subida de 10 = recarga, con caída neta positiva → null',
      [80, 80, 70, 70, 80, 80, 40, 40],
      100,
      null,
    ],
    ['subida de 9 no es recarga → caída neta', [80, 80, 70, 70, 79, 79, 40, 40], 100, 40],
    ['subida de 22 = recarga → null', [80, 80, 50, 50, 72, 72, 40, 40], 100, null],
    ['caída 0 → null (no 0)', [50, 50, 50, 50], 100, null],
    ['cap 0 → null', [80, 79, 78, 77], 0, null],
    ['cap Infinity → null', [80, 75, 70, 65], Number.POSITIVE_INFINITY, null],
    ['cap NaN → null', [80, 75, 70, 65], Number.NaN, null],
    ['sin capacidad → null', [80, 79, 78, 77], null, null],
    ['3 lecturas: una sola mediana → null', [80, 70, 60], 100, null],
    ['4 lecturas: caída entre medianas', [80, 70, 60, 50], 100, 10],
    ['menos de 3 lecturas de 89 → null', [80, 79], 600, null],
  ] as const)('nivel 89: %s', (_c, p89, cap, esperado) => {
    const l = tramo(
      p89.map(() => null),
      [...p89],
    );
    const v = resumirCanSegmento(l, 10, cap).litrosNivelSinRecarga;
    esperado === null ? expect(v).toBeNull() : expect(v).toBeCloseTo(esperado, 6);
  });

  it('paso negativo chico (−0,3 L) cuenta como negativo', () => {
    expect(resumirCanSegmento(tramo([100, 100.5, 100.2, 101]), 10, null).can83).toMatchObject({
      pasosNegativos: 1,
    });
  });

  it('cobertura > 100 se recorta a 100; distancia 0 → cobertura 0', () => {
    const l = tramo([1000, 1010, 1020]);
    const km = distanciaRecorrida(l);
    expect(resumirCanSegmento(l, km / 2, null).can83?.coberturaKmPct).toBe(100);
    expect(resumirCanSegmento(l, 0, null).can83?.coberturaKmPct).toBe(0);
  });

  it('83 parcial: la cobertura se mide solo entre la primera y la última lectura del 83', () => {
    const l = tramo([null, 1000, 1010, null, null]);
    const km = distanciaRecorrida(l);
    expect(resumirCanSegmento(l, km, null).can83?.coberturaKmPct).toBeCloseTo(25, 6);
  });

  it('resumen + decisión: 83 limpio da can_83 y la discrepancia con el nivel solo alerta', () => {
    const l = tramo([1000, 1035, 1070, 1105, 1140], [80, 70, 60, 50, 40]);
    const r = resumirCanSegmento(l, distanciaRecorrida(l), 600);
    const d = decidirFuenteHuella({
      gpsTeltonika: { estado: 'ok', coberturaPct: 100, distanciaKm: 400 },
      gpsMovil: null,
      pingsEnVentana: 5,
      combustible: 'Diesel',
      can83: { ...(r.can83 as NonNullable<typeof r.can83>), coberturaKmPct: 100 },
      litrosNivelSinRecarga: r.litrosNivelSinRecarga,
      consumoBasePor100km: null,
      perfilEnergetico: 'consumo_base',
      pesoDeclarado: true,
    });
    expect(r.litrosNivelSinRecarga).toBeCloseTo(120, 6);
    expect(d).toMatchObject({ fuenteEnergia: 'can_83', alertas: [] });
    expect(d.litrosCan).toBeCloseTo(140, 6);
  });
});

describe('filas solo-89 no densifican la cobertura del 83 (QA #868 v2)', () => {
  // 83 en A y D (recta ≈111,2 km); solo-89 en B y C con desvío (≈155 km); segmento 155,6 km.
  const filas: LecturaSegmentoCan[] = [
    { tMs: 0, lat: -33, lng: -70.6, io: { '83': 10000 } },
    { tMs: 1, lat: -33.33, lng: -70.1, io: { '89': 50 } },
    { tMs: 2, lat: -33.67, lng: -70.1, io: { '89': 49 } },
    { tMs: 3, lat: -34, lng: -70.6, io: { '83': 10600 } },
  ];

  it('filas solo-89 no cambian el resultado del 83: sigue cobertura_insuficiente', () => {
    // Sin el filtro, las solo-89 densifican la polilínea y el 83 pasaría con 60 L.
    expect(consumoCanSegmento({ lecturas: filas, distanciaSegmentoKm: 155.6 })).toEqual({
      litros: 60,
    });
    expect(
      consumoCanSegmento({ lecturas: soloLecturas83(filas), distanciaSegmentoKm: 155.6 }),
    ).toEqual({ litros: null, motivo: 'cobertura_insuficiente' });
  });

  it('resumidor: la cobertura del 83 tampoco se densifica', () => {
    const recta = distanciaRecorrida(soloLecturas83(filas));
    expect(resumirCanSegmento(filas, 155.6, null).can83?.coberturaKmPct).toBeCloseTo(
      (recta / 155.6) * 100,
      6,
    );
  });
});

describe('filtro laxo de emisión = main (QA #868 v3)', () => {
  // A y C válidos; B con 83 = 1e15 (fuera de rango) y desvío. Main lo conserva y
  // densifica la cobertura: {litros: 60}. El estricto lo descartaría.
  const filas: LecturaSegmentoCan[] = [
    { tMs: 0, lat: -33, lng: -70.6, io: { '83': 10000 } },
    { tMs: 1, lat: -33.5, lng: -70.05, io: { '83': 1e15 } },
    { tMs: 2, lat: -34, lng: -70.6, io: { '83': 10600 } },
  ];

  it('83 fuera de rango se conserva en la emisión: {litros: 60} como main', () => {
    expect(filasConLectura83(filas)).toHaveLength(3);
    expect(
      consumoCanSegmento({ lecturas: filasConLectura83(filas), distanciaSegmentoKm: 155.6 }),
    ).toEqual({ litros: 60 });
    expect(
      consumoCanSegmento({ lecturas: soloLecturas83(filas), distanciaSegmentoKm: 155.6 }),
    ).toEqual({ litros: null, motivo: 'cobertura_insuficiente' });
  });

  it('las filas solo-89 salen con los dos filtros', () => {
    const f = [...filas, { tMs: 3, lat: -34, lng: -70.6, io: { '89': 40 } }];
    expect(filasConLectura83(f)).toHaveLength(3);
    expect(soloLecturas83(f)).toHaveLength(2);
  });
});
