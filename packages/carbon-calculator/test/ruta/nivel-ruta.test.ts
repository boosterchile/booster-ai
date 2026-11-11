import { describe, expect, it } from 'vitest';
import { derivarNivelCertificacion } from '../../src/index.js';
import { derivarNivelRuta } from '../../src/ruta/index.js';
import type { MetodoPrecision, RouteDataSource } from '../../src/tipos.js';

const FUENTES: RouteDataSource[] = [
  'teltonika_gps',
  'movil_gps',
  'maps_directions',
  'manual_declared',
];
const METODOS: MetodoPrecision[] = ['exacto_canbus', 'modelado', 'por_defecto'];

describe('derivarNivelRuta', () => {
  it('con un solo tramo da lo mismo que el viaje de hoy, en toda la matriz', () => {
    for (const precisionMethod of METODOS) {
      for (const routeDataSource of FUENTES) {
        for (const coveragePct of [0, 79.9, 80, 94.9, 95, 100]) {
          expect(
            derivarNivelRuta({
              precisionMethod,
              tramos: [{ distanciaKm: 100, routeDataSource, coveragePct }],
            }),
          ).toEqual({
            nivel: derivarNivelCertificacion({ precisionMethod, routeDataSource, coveragePct }),
            routeDataSource,
            coveragePct,
          });
        }
      }
    }
  });

  it('la cobertura de la ruta es la de sus tramos, ponderada por distancia', () => {
    const r = derivarNivelRuta({
      precisionMethod: 'exacto_canbus',
      tramos: [
        { distanciaKm: 300, routeDataSource: 'teltonika_gps', coveragePct: 100 },
        { distanciaKm: 100, routeDataSource: 'teltonika_gps', coveragePct: 60 },
      ],
    });
    expect(r).toEqual({
      nivel: 'secundario_modeled',
      routeDataSource: 'teltonika_gps',
      coveragePct: 90,
    });
  });

  it('un tramo corto mal cubierto no le quita el nivel primario a una ruta bien medida', () => {
    const r = derivarNivelRuta({
      precisionMethod: 'exacto_canbus',
      tramos: [
        { distanciaKm: 980, routeDataSource: 'teltonika_gps', coveragePct: 99 },
        { distanciaKm: 20, routeDataSource: 'teltonika_gps', coveragePct: 50 },
      ],
    });
    expect(r.nivel).toBe('primario_verificable');
    expect(r.coveragePct).toBeCloseTo(98.02, 2);
  });

  it('la fuente de la ruta es la más débil de sus tramos', () => {
    const tramo = (routeDataSource: RouteDataSource) => ({
      distanciaKm: 100,
      routeDataSource,
      coveragePct: 100,
    });
    const fuente = (...fuentes: RouteDataSource[]) =>
      derivarNivelRuta({ precisionMethod: 'exacto_canbus', tramos: fuentes.map(tramo) });

    expect(fuente('teltonika_gps', 'teltonika_gps')).toMatchObject({
      routeDataSource: 'teltonika_gps',
      nivel: 'primario_verificable',
    });
    // Un tramo medido con el celular: la ruta ya no es primaria (ADR-077).
    expect(fuente('teltonika_gps', 'movil_gps')).toMatchObject({
      routeDataSource: 'movil_gps',
      nivel: 'secundario_modeled',
    });
    expect(fuente('movil_gps', 'maps_directions')).toMatchObject({
      routeDataSource: 'maps_directions',
      nivel: 'secundario_modeled',
    });
    // Un tramo declarado a mano baja toda la ruta al último nivel.
    expect(fuente('teltonika_gps', 'maps_directions', 'manual_declared')).toMatchObject({
      routeDataSource: 'manual_declared',
      nivel: 'secundario_default',
    });
  });

  it('el resultado no depende del orden de los tramos', () => {
    const tramos = [
      { distanciaKm: 300, routeDataSource: 'teltonika_gps' as const, coveragePct: 97 },
      { distanciaKm: 50, routeDataSource: 'movil_gps' as const, coveragePct: 80 },
      { distanciaKm: 120, routeDataSource: 'teltonika_gps' as const, coveragePct: 91 },
    ];
    const a = derivarNivelRuta({ precisionMethod: 'modelado', tramos });
    const b = derivarNivelRuta({ precisionMethod: 'modelado', tramos: [...tramos].reverse() });
    expect(b.nivel).toBe(a.nivel);
    expect(b.routeDataSource).toBe(a.routeDataSource);
    expect(b.coveragePct).toBeCloseTo(a.coveragePct, 9);
  });

  it('una ruta sin distancia no tiene cobertura', () => {
    const r = derivarNivelRuta({
      precisionMethod: 'exacto_canbus',
      tramos: [{ distanciaKm: 0, routeDataSource: 'teltonika_gps', coveragePct: 100 }],
    });
    expect(r).toMatchObject({ coveragePct: 100, nivel: 'primario_verificable' });
    const varios = derivarNivelRuta({
      precisionMethod: 'exacto_canbus',
      tramos: [
        { distanciaKm: 0, routeDataSource: 'teltonika_gps', coveragePct: 100 },
        { distanciaKm: 0, routeDataSource: 'teltonika_gps', coveragePct: 100 },
      ],
    });
    expect(varios).toMatchObject({ coveragePct: 0, nivel: 'secundario_modeled' });
  });

  it.each([
    ['sin tramos', []],
    [
      'cobertura fuera de rango',
      [{ distanciaKm: 1, routeDataSource: 'teltonika_gps', coveragePct: 101 }],
    ],
    [
      'distancia negativa',
      [{ distanciaKm: -1, routeDataSource: 'teltonika_gps', coveragePct: 50 }],
    ],
  ] as const)('rechaza: %s', (_nombre, tramos) => {
    expect(() => derivarNivelRuta({ precisionMethod: 'modelado', tramos: [...tramos] })).toThrow();
  });
});
