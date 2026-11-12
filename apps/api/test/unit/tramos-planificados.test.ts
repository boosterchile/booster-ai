import { describe, expect, it } from 'vitest';
import { tramosPlanificados } from '../../src/services/tramos-recorridos.js';

const parada = (tripId: string, tipo: 'recogida' | 'entrega') => ({ tripId, tipo });
const PESOS = new Map([
  ['a', 8000],
  ['b', 5000],
]);

describe('tramosPlanificados: la carga a bordo entre parada y parada, según el plan', () => {
  it('una ruta de dos paradas es un tramo con la carga del servicio', () => {
    expect(
      tramosPlanificados([parada('a', 'recogida'), parada('a', 'entrega')], PESOS, [120]),
    ).toEqual([{ distanciaKm: 120, cargaKg: 8000 }]);
  });

  it('la carga sube en cada recogida y baja en cada entrega', () => {
    const paradas = [
      parada('a', 'recogida'),
      parada('b', 'recogida'),
      parada('a', 'entrega'),
      parada('b', 'entrega'),
    ];
    expect(tramosPlanificados(paradas, PESOS, [10, 40, 25])).toEqual([
      { distanciaKm: 10, cargaKg: 8000 },
      { distanciaKm: 40, cargaKg: 13000 },
      { distanciaKm: 25, cargaKg: 5000 },
    ]);
  });

  it('entre una entrega y la recogida siguiente el camión va vacío', () => {
    const paradas = [
      parada('a', 'recogida'),
      parada('a', 'entrega'),
      parada('b', 'recogida'),
      parada('b', 'entrega'),
    ];
    expect(tramosPlanificados(paradas, PESOS, [30, 12, 20]).map((t) => t.cargaKg)).toEqual([
      8000, 0, 5000,
    ]);
  });

  it('un servicio sin peso declarado cuenta como 0, igual que en la estimación del viaje', () => {
    expect(
      tramosPlanificados([parada('x', 'recogida'), parada('x', 'entrega')], PESOS, [50]),
    ).toEqual([{ distanciaKm: 50, cargaKg: 0 }]);
  });

  it('exige una distancia por cada par de paradas seguidas', () => {
    expect(() =>
      tramosPlanificados([parada('a', 'recogida'), parada('a', 'entrega')], PESOS, []),
    ).toThrow(/una distancia por tramo/);
    expect(() => tramosPlanificados([parada('a', 'recogida')], PESOS, [])).toThrow(
      /al menos dos paradas/,
    );
  });
});
