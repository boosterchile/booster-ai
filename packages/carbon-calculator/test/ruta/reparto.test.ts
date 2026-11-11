import { describe, expect, it } from 'vitest';
import {
  type ServicioParaReparto,
  VERSION_METODO_REPARTO,
  repartirPorActividad,
} from '../../src/ruta/index.js';
import { barajar, generador } from './generador.js';

const CASOS = 500;
/** 500 casos por test; el límite por defecto de 5 s no alcanza en un runner cargado. */
const LIMITE_MS = 60_000;

const milesimas = (kg: number) => Math.round(kg * 1000);
const centesimas = (pct: number) => Math.round(pct * 100);
const s = (
  servicioId: string,
  masaKg: number,
  distanciaDirectaKm: number,
): ServicioParaReparto => ({
  servicioId,
  masaKg,
  distanciaDirectaKm,
});

function rutaAleatoria(semilla: number) {
  const g = generador(semilla);
  const n = g.entero(1, 8);
  const servicios = Array.from({ length: n }, (_, i) =>
    s(
      `srv-${String(i).padStart(2, '0')}`,
      g.entero(1, 28_000),
      Math.round(g.real(1, 2_000) * 1000) / 1000,
    ),
  );
  const ttw = Math.round(g.real(0, 5_000) * 1000) / 1000;
  const wtt = Math.round(g.real(0, 1_500) * 1000) / 1000;
  const totales = { wtw: Math.round((ttw + wtt) * 1000) / 1000, ttw, wtt };
  return { g, servicios, totales };
}

describe('repartirPorActividad — ejemplos', () => {
  it('reparte en proporción a masa × distancia directa', () => {
    const r = repartirPorActividad({
      totales: { wtw: 100 },
      servicios: [s('a', 1_000, 100), s('b', 3_000, 100)],
    });
    expect(r).toEqual([
      { servicioId: 'a', actividadTkm: 100, participacionPct: 25, partes: { wtw: 25 } },
      { servicioId: 'b', actividadTkm: 300, participacionPct: 75, partes: { wtw: 75 } },
    ]);
  });

  it('la distancia es la directa de cada carga, no la que recorrió el camión', () => {
    // Misma masa; la que va más lejos lleva más parte.
    const r = repartirPorActividad({
      totales: { wtw: 90 },
      servicios: [s('cerca', 5_000, 100), s('lejos', 5_000, 200)],
    });
    expect(r.map((x) => x.partes.wtw)).toEqual([30, 60]);
  });

  it('un servicio solo recibe el 100 %, exactamente el total publicado', () => {
    const totales = { wtw: 389.417, ttw: 318.6, wtt: 70.817 };
    const r = repartirPorActividad({ totales, servicios: [s('unico', 12_000, 350)] });
    expect(r).toEqual([
      { servicioId: 'unico', actividadTkm: 4_200, participacionPct: 100, partes: totales },
    ]);
  });

  it('un servicio solo sin peso declarado también recibe el 100 %', () => {
    const r = repartirPorActividad({ totales: { wtw: 12.345 }, servicios: [s('unico', 0, 350)] });
    expect(r).toEqual([
      { servicioId: 'unico', actividadTkm: 0, participacionPct: 100, partes: { wtw: 12.345 } },
    ]);
  });

  it('redondea por resto mayor: el gramo que sobra va al de mayor resto', () => {
    // 0,010 kg entre tres iguales: 3 g cada uno y sobra 1 g.
    const r = repartirPorActividad({
      totales: { wtw: 0.01 },
      servicios: [s('c', 1_000, 10), s('a', 1_000, 10), s('b', 1_000, 10)],
    });
    // Empate de restos: desempata el identificador.
    expect(r.map((x) => [x.servicioId, x.partes.wtw])).toEqual([
      ['a', 0.004],
      ['b', 0.003],
      ['c', 0.003],
    ]);
    expect(r.map((x) => x.participacionPct)).toEqual([33.34, 33.33, 33.33]);
  });

  it('un total en cero reparte ceros', () => {
    const r = repartirPorActividad({
      totales: { wtw: 0 },
      servicios: [s('a', 1_000, 10), s('b', 2_000, 10)],
    });
    expect(r.map((x) => x.partes.wtw)).toEqual([0, 0]);
  });

  it('devuelve los servicios ordenados por identificador', () => {
    const r = repartirPorActividad({
      totales: { wtw: 10 },
      servicios: [s('z', 1, 1), s('a', 1, 1), s('m', 1, 1)],
    });
    expect(r.map((x) => x.servicioId)).toEqual(['a', 'm', 'z']);
  });

  it('declara la versión del método', () => {
    expect(VERSION_METODO_REPARTO).toBe('tkm-distancia-directa-v1');
  });
});

describe('repartirPorActividad — entradas que rechaza', () => {
  it.each([
    ['sin servicios', { totales: { wtw: 1 }, servicios: [] }],
    ['identificador repetido', { totales: { wtw: 1 }, servicios: [s('a', 1, 1), s('a', 2, 1)] }],
    ['masa negativa', { totales: { wtw: 1 }, servicios: [s('a', -1, 1)] }],
    ['distancia negativa', { totales: { wtw: 1 }, servicios: [s('a', 1, -1)] }],
    ['masa no finita', { totales: { wtw: 1 }, servicios: [s('a', Number.NaN, 1)] }],
    ['total negativo', { totales: { wtw: -1 }, servicios: [s('a', 1, 1)] }],
    ['total no finito', { totales: { wtw: Number.POSITIVE_INFINITY }, servicios: [s('a', 1, 1)] }],
    [
      'varios servicios y ninguno con actividad',
      { totales: { wtw: 1 }, servicios: [s('a', 0, 10), s('b', 0, 10)] },
    ],
  ])('%s', (_nombre, input) => {
    expect(() => repartirPorActividad(input)).toThrow();
  });

  it('en una ruta con varios servicios, uno sin peso recibe cero y no rompe el reparto', () => {
    // La spec no deja entrar un servicio sin peso a una ruta consolidada; si
    // llegara, no se le inventa actividad.
    const r = repartirPorActividad({
      totales: { wtw: 10 },
      servicios: [s('a', 0, 10), s('b', 1_000, 10)],
    });
    expect(r.map((x) => x.partes.wtw)).toEqual([0, 10]);
  });
});

describe('repartirPorActividad — propiedades', () => {
  it(
    'las partes publicadas suman exactamente el total publicado, en cada componente',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const { servicios, totales } = rutaAleatoria(caso);
        const r = repartirPorActividad({ totales, servicios });
        for (const k of ['wtw', 'ttw', 'wtt'] as const) {
          const suma = r.reduce((acc, x) => acc + milesimas(x.partes[k]), 0);
          expect(suma, `caso ${caso}, ${k}`).toBe(milesimas(totales[k]));
        }
      }
    },
    LIMITE_MS,
  );

  it(
    'las participaciones publicadas suman exactamente 100 %',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const { servicios, totales } = rutaAleatoria(caso + 10_000);
        const r = repartirPorActividad({ totales, servicios });
        expect(
          r.reduce((acc, x) => acc + centesimas(x.participacionPct), 0),
          `caso ${caso}`,
        ).toBe(10_000);
      }
    },
    LIMITE_MS,
  );

  it(
    'ninguna parte es negativa y ninguna se aleja un gramo o más de su cuota exacta',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const { servicios, totales } = rutaAleatoria(caso + 20_000);
        const r = repartirPorActividad({ totales, servicios });
        const actividadTotal = servicios.reduce((a, x) => a + x.masaKg * x.distanciaDirectaKm, 0);
        for (const parte of r) {
          const srv = servicios.find((x) => x.servicioId === parte.servicioId);
          const cuota =
            (milesimas(totales.wtw) * (srv?.masaKg ?? 0) * (srv?.distanciaDirectaKm ?? 0)) /
            actividadTotal;
          expect(parte.partes.wtw, `caso ${caso}`).toBeGreaterThanOrEqual(0);
          expect(Math.abs(milesimas(parte.partes.wtw) - cuota), `caso ${caso}`).toBeLessThan(1);
        }
      }
    },
    LIMITE_MS,
  );

  it(
    'el resultado no depende del orden en que llegan los servicios',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const { g, servicios, totales } = rutaAleatoria(caso + 30_000);
        const base = repartirPorActividad({ totales, servicios });
        const barajado = repartirPorActividad({ totales, servicios: barajar(g, servicios) });
        expect(barajado, `caso ${caso}`).toEqual(base);
      }
    },
    LIMITE_MS,
  );

  it(
    'a más actividad, nunca menos parte',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const { servicios, totales } = rutaAleatoria(caso + 40_000);
        const r = repartirPorActividad({ totales, servicios });
        const porActividad = [...r].sort((a, b) => a.actividadTkm - b.actividadTkm);
        for (let i = 1; i < porActividad.length; i += 1) {
          const menor = porActividad[i - 1];
          const mayor = porActividad[i];
          if (menor && mayor && mayor.actividadTkm > menor.actividadTkm) {
            // El redondeo puede dar el mismo valor, nunca invertir el orden por más de un gramo.
            expect(
              milesimas(mayor.partes.wtw) - milesimas(menor.partes.wtw),
              `caso ${caso}`,
            ).toBeGreaterThanOrEqual(-1);
          }
        }
      }
    },
    LIMITE_MS,
  );
});
