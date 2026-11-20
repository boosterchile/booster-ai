import { describe, expect, it } from 'vitest';
import { calcularEmisionesViaje } from '../../src/index.js';
import { calcularEmisionesRuta } from '../../src/ruta/index.js';
import type { ParametrosPorDefecto, PerfilVehiculo, TipoCombustible } from '../../src/tipos.js';
import { generador } from './generador.js';

const CASOS = 300;
const LIMITE_MS = 60_000;

const VEHICULO: PerfilVehiculo = {
  combustible: 'diesel',
  consumoBasePor100km: 28,
  pesoVacioKg: 8_000,
  capacidadKg: 25_000,
};
const COMBUSTIBLES: TipoCombustible[] = ['diesel', 'gasolina'];
const TIPOS: ParametrosPorDefecto['tipoVehiculo'][] = [
  'camioneta',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
  'semi_remolque',
];

/** Lo que el viaje y la ruta publican en común. */
const comun = (r: ReturnType<typeof calcularEmisionesViaje>) => ({
  emisionesKgco2eWtw: r.emisionesKgco2eWtw,
  emisionesKgco2eTtw: r.emisionesKgco2eTtw,
  emisionesKgco2eWtt: r.emisionesKgco2eWtt,
  combustibleConsumido: r.combustibleConsumido,
  unidadCombustible: r.unidadCombustible,
  distanciaKm: r.distanciaKm,
  intensidadGco2ePorTonKm: r.intensidadGco2ePorTonKm,
  metodoPrecision: r.metodoPrecision,
  factorEmisionUsado: r.factorEmisionUsado,
  versionGlec: r.versionGlec,
  fuenteFactores: r.fuenteFactores,
});

describe('calcularEmisionesRuta — una ruta de dos paradas es el viaje de hoy (criterio 4)', () => {
  it(
    'modelado',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const g = generador(caso);
        const distanciaKm = g.real(0, 2_500);
        const cargaKg = g.entero(0, 25_000);
        const vehiculo = {
          ...VEHICULO,
          combustible: COMBUSTIBLES[g.entero(0, 1)] ?? 'diesel',
          consumoBasePor100km: g.real(6, 45),
        };
        const viaje = calcularEmisionesViaje({
          metodo: 'modelado',
          distanciaKm,
          cargaKg,
          vehiculo,
        });
        const ruta = calcularEmisionesRuta({
          metodo: 'modelado',
          tramos: [{ distanciaKm, cargaKg }],
          vehiculo,
        });
        expect(ruta, `caso ${caso}`).toMatchObject(comun(viaje));
        expect(ruta.tramos).toEqual([viaje]);
      }
    },
    LIMITE_MS,
  );

  it(
    'por defecto',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const g = generador(caso + 1_000);
        const distanciaKm = g.real(0, 2_500);
        const cargaKg = g.entero(0, 20_000);
        const tipoVehiculo = TIPOS[g.entero(0, TIPOS.length - 1)] ?? 'camion_mediano';
        const viaje = calcularEmisionesViaje({
          metodo: 'por_defecto',
          distanciaKm,
          cargaKg,
          tipoVehiculo,
        });
        const ruta = calcularEmisionesRuta({
          metodo: 'por_defecto',
          tramos: [{ distanciaKm, cargaKg }],
          tipoVehiculo,
        });
        expect(ruta, `caso ${caso}`).toMatchObject(comun(viaje));
      }
    },
    LIMITE_MS,
  );

  it(
    'combustible medido',
    () => {
      for (let caso = 1; caso <= CASOS; caso += 1) {
        const g = generador(caso + 2_000);
        const distanciaKm = g.real(0, 2_500);
        const cargaKg = g.entero(0, 25_000);
        const combustibleConsumido = g.real(0, 900);
        const viaje = calcularEmisionesViaje({
          metodo: 'exacto_canbus',
          distanciaKm,
          combustibleConsumido,
          cargaKg,
          vehiculo: VEHICULO,
        });
        const ruta = calcularEmisionesRuta({
          metodo: 'exacto_canbus',
          tramos: [{ distanciaKm, cargaKg }],
          combustibleConsumido,
          vehiculo: VEHICULO,
        });
        expect(ruta, `caso ${caso}`).toMatchObject(comun(viaje));
        expect(ruta.tramos).toBeNull();
      }
    },
    LIMITE_MS,
  );
});

describe('calcularEmisionesRuta — varios tramos', () => {
  const TRAMOS = [
    { distanciaKm: 120, cargaKg: 4_000 },
    { distanciaKm: 80, cargaKg: 10_000 },
    { distanciaKm: 60, cargaKg: 6_000 },
    { distanciaKm: 150, cargaKg: 0 },
  ];

  it('modelado: la emisión de la ruta es la suma de sus tramos, cargados y vacíos', () => {
    const ruta = calcularEmisionesRuta({ metodo: 'modelado', tramos: TRAMOS, vehiculo: VEHICULO });
    const sueltos = TRAMOS.map((t) =>
      calcularEmisionesViaje({ metodo: 'modelado', ...t, vehiculo: VEHICULO }),
    );
    const suma = (k: 'emisionesKgco2eWtw' | 'emisionesKgco2eTtw' | 'emisionesKgco2eWtt') =>
      Math.round(sueltos.reduce((a, x) => a + x[k], 0) * 1000) / 1000;

    expect(ruta.tramos).toEqual(sueltos);
    expect(ruta.emisionesKgco2eWtw).toBe(suma('emisionesKgco2eWtw'));
    expect(ruta.emisionesKgco2eTtw).toBe(suma('emisionesKgco2eTtw'));
    expect(ruta.emisionesKgco2eWtt).toBe(suma('emisionesKgco2eWtt'));
    expect(ruta.distanciaKm).toBe(410);
    expect(ruta.metodoPrecision).toBe('modelado');
  });

  it('el tramo vacío emite: la ruta con regreso pesa más que sin él', () => {
    const conRegreso = calcularEmisionesRuta({
      metodo: 'modelado',
      tramos: TRAMOS,
      vehiculo: VEHICULO,
    });
    const sinRegreso = calcularEmisionesRuta({
      metodo: 'modelado',
      tramos: TRAMOS.slice(0, 3),
      vehiculo: VEHICULO,
    });
    expect(conRegreso.emisionesKgco2eWtw).toBeGreaterThan(sinRegreso.emisionesKgco2eWtw);
    // La actividad de transporte no cambia: el tramo vacío no mueve carga.
    expect(conRegreso.actividadTkm).toBe(sinRegreso.actividadTkm);
  });

  it('la actividad es la suma de toneladas-kilómetro de los tramos, y la intensidad sale de ella', () => {
    const ruta = calcularEmisionesRuta({ metodo: 'modelado', tramos: TRAMOS, vehiculo: VEHICULO });
    // 4 t × 120 + 10 t × 80 + 6 t × 60 + 0
    expect(ruta.actividadTkm).toBe(1_640);
    expect(ruta.intensidadGco2ePorTonKm).toBe(
      Math.round(((ruta.emisionesKgco2eWtw * 1000) / 1_640) * 100) / 100,
    );
  });

  it('una ruta sin carga en ningún tramo tiene intensidad cero', () => {
    const ruta = calcularEmisionesRuta({
      metodo: 'modelado',
      tramos: [
        { distanciaKm: 50, cargaKg: 0 },
        { distanciaKm: 70, cargaKg: 0 },
      ],
      vehiculo: VEHICULO,
    });
    expect(ruta.actividadTkm).toBe(0);
    expect(ruta.intensidadGco2ePorTonKm).toBe(0);
    expect(ruta.emisionesKgco2eWtw).toBeGreaterThan(0);
  });

  it('por defecto: suma tramos y conserva el método y la fuente de los factores', () => {
    const ruta = calcularEmisionesRuta({
      metodo: 'por_defecto',
      tramos: TRAMOS,
      tipoVehiculo: 'camion_mediano',
    });
    expect(ruta.metodoPrecision).toBe('por_defecto');
    expect(ruta.fuenteFactores).toContain('camion_mediano');
    expect(ruta.tramos).toHaveLength(4);
  });

  it('combustible medido: la emisión sale del combustible de toda la ruta, sin desglose por tramo', () => {
    const ruta = calcularEmisionesRuta({
      metodo: 'exacto_canbus',
      tramos: TRAMOS,
      combustibleConsumido: 115,
      vehiculo: VEHICULO,
    });
    const referencia = calcularEmisionesViaje({
      metodo: 'exacto_canbus',
      distanciaKm: 410,
      combustibleConsumido: 115,
      cargaKg: 0,
      vehiculo: VEHICULO,
    });
    expect(ruta.emisionesKgco2eWtw).toBe(referencia.emisionesKgco2eWtw);
    expect(ruta.emisionesKgco2eTtw).toBe(referencia.emisionesKgco2eTtw);
    expect(ruta.emisionesKgco2eWtt).toBe(referencia.emisionesKgco2eWtt);
    expect(ruta.combustibleConsumido).toBe(115);
    expect(ruta.distanciaKm).toBe(410);
    expect(ruta.actividadTkm).toBe(1_640);
    expect(ruta.intensidadGco2ePorTonKm).toBe(
      Math.round(((ruta.emisionesKgco2eWtw * 1000) / 1_640) * 100) / 100,
    );
    expect(ruta.tramos).toBeNull();
  });
});

describe('calcularEmisionesRuta — entradas que rechaza', () => {
  it('una ruta sin tramos', () => {
    expect(() =>
      calcularEmisionesRuta({ metodo: 'modelado', tramos: [], vehiculo: VEHICULO }),
    ).toThrow(/tramo/);
  });

  it.each([
    ['distancia negativa', { distanciaKm: -1, cargaKg: 10 }],
    ['carga negativa', { distanciaKm: 10, cargaKg: -1 }],
    ['distancia no finita', { distanciaKm: Number.NaN, cargaKg: 10 }],
  ])('%s', (_nombre, tramo) => {
    for (const metodo of ['modelado', 'exacto_canbus'] as const) {
      expect(() =>
        calcularEmisionesRuta({
          metodo,
          tramos: [{ distanciaKm: 10, cargaKg: 10 }, tramo],
          combustibleConsumido: 5,
          vehiculo: VEHICULO,
        }),
      ).toThrow();
    }
  });

  it('modelado sin consumo declarado en el vehículo', () => {
    expect(() =>
      calcularEmisionesRuta({
        metodo: 'modelado',
        tramos: [{ distanciaKm: 10, cargaKg: 10 }],
        vehiculo: { ...VEHICULO, consumoBasePor100km: null },
      }),
    ).toThrow(/consumoBasePor100km/);
  });
});
