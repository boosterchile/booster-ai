import { describe, expect, it } from 'vitest';
import { type LecturaSegmentoCan, distanciaRecorrida } from './consumo-can-segmento.js';
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

  it.each([
    ['glitch de 1 muestra filtrado', [80, 79, 78, 20, 77, 76], 600, 18],
    ['recarga (subida ≥10 puntos) → null', [50, 49, 48, 70, 72, 71], 600, null],
    ['sin capacidad → null', [80, 79, 78, 77], null, null],
    ['menos de 3 lecturas de 89 → null', [80, 79], 600, null],
  ] as const)('nivel 89: %s', (_c, p89, cap, esperado) => {
    const l = tramo(
      p89.map(() => null),
      [...p89],
    );
    const v = resumirCanSegmento(l, 10, cap).litrosNivelSinRecarga;
    esperado === null ? expect(v).toBeNull() : expect(v).toBeCloseTo(esperado, 6);
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
