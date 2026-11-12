import { describe, expect, it, vi } from 'vitest';
import {
  MINUTOS_POR_PARADA_INTERMEDIA,
  contextoDeRuta,
  minutosPorParadasIntermedias,
} from '../../src/services/ruta-en-seguimiento.js';

// ruta-parada-servicio §4.7: la hora estimada suma las paradas intermedias
// que quedan antes de la entrega del servicio.
describe('minutosPorParadasIntermedias', () => {
  const santiago = { lat: -33.45, lng: -70.66 };
  const rancagua = { lat: -34.17, lng: -70.74 };
  const talca = { lat: -35.43, lng: -71.66 };

  it('sin paradas intermedias no suma nada', () => {
    expect(
      minutosPorParadasIntermedias({
        posicion: santiago,
        destino: talca,
        paradas: [],
        avgSpeedKmh: 80,
      }),
    ).toBe(0);
  });

  it('una parada de camino suma su tiempo de detención y casi nada de desvío', () => {
    const extra = minutosPorParadasIntermedias({
      posicion: santiago,
      destino: talca,
      paradas: [rancagua],
      avgSpeedKmh: 80,
    });
    expect(extra).toBeGreaterThanOrEqual(MINUTOS_POR_PARADA_INTERMEDIA);
    expect(extra).toBeLessThan(MINUTOS_POR_PARADA_INTERMEDIA + 15);
  });

  it('una parada que desvía suma el desvío: ir y volver a Valparaíso', () => {
    const valparaiso = { lat: -33.05, lng: -71.61 };
    const directa = minutosPorParadasIntermedias({
      posicion: santiago,
      destino: talca,
      paradas: [rancagua],
      avgSpeedKmh: 80,
    });
    const conDesvio = minutosPorParadasIntermedias({
      posicion: santiago,
      destino: talca,
      paradas: [valparaiso],
      avgSpeedKmh: 80,
    });
    expect(conDesvio).toBeGreaterThan(directa + 60);
  });

  it('dos paradas suman dos detenciones', () => {
    const extra = minutosPorParadasIntermedias({
      posicion: santiago,
      destino: talca,
      paradas: [rancagua, rancagua],
      avgSpeedKmh: 80,
    });
    expect(extra).toBeGreaterThanOrEqual(2 * MINUTOS_POR_PARADA_INTERMEDIA);
  });

  it('sin coordenadas de una parada o del destino, o sin velocidad, suma solo las detenciones', () => {
    const base = { posicion: santiago, destino: talca, paradas: [rancagua], avgSpeedKmh: 80 };
    for (const caso of [
      { ...base, paradas: [null] },
      { ...base, destino: null },
      { ...base, avgSpeedKmh: null },
      { ...base, avgSpeedKmh: 0 },
    ]) {
      expect(minutosPorParadasIntermedias(caso)).toBe(MINUTOS_POR_PARADA_INTERMEDIA);
    }
  });
});

// El recorrido contra PostgreSQL está en ruta-consolidada.integration.test.ts.
describe('contextoDeRuta', () => {
  const fila = (
    orden: number,
    tipo: 'recogida' | 'entrega',
    letra: string,
    cambios: Record<string, unknown> = {},
  ) => ({
    orden,
    tipo,
    tripId: `viaje-${letra}`,
    resolvedAt: null,
    asignacionId: `asig-${letra}`,
    estado: 'asignado',
    origenLat: '-34.1700000',
    origenLng: '-70.7400000',
    destinoLat: null,
    destinoLng: null,
    ...cambios,
  });
  const dbCon = (filas: unknown[]) => {
    const cadena: Promise<unknown[]> & Record<string, () => unknown> = Object.assign(
      Promise.resolve(filas),
      { from: () => cadena, innerJoin: () => cadena, where: () => cadena, orderBy: () => cadena },
    );
    return { select: vi.fn(() => cadena) } as never;
  };
  const pedir = (filas: unknown[], tripId = 'viaje-a') =>
    contextoDeRuta(dbCon(filas), { rutaId: 'ruta-1', tripId });
  const JUNTAS = [
    fila(0, 'recogida', 'a', { resolvedAt: new Date() }),
    fila(1, 'recogida', 'b'),
    fila(2, 'entrega', 'a'),
    fila(3, 'entrega', 'b', { destinoLat: 'x', destinoLng: '-70.0' }),
  ];

  it('ruta compartida: las paradas pendientes de otros antes de mi entrega', async () => {
    expect(await pedir(JUNTAS)).toEqual({
      compartida: true,
      asignacionIds: ['asig-a', 'asig-b'],
      paradasIntermedias: [{ lat: -34.17, lng: -70.74 }],
    });
    // Para b: la entrega de a va antes y no tiene coordenadas.
    expect((await pedir(JUNTAS, 'viaje-b')).paradasIntermedias).toEqual([null]);
  });

  it('una coordenada que no es número cuenta como desconocida', async () => {
    const filas = [
      fila(0, 'recogida', 'a'),
      fila(1, 'entrega', 'b', { destinoLat: 'x', destinoLng: '1' }),
      fila(2, 'recogida', 'b'),
      fila(3, 'entrega', 'a'),
    ];
    expect((await pedir(filas)).paradasIntermedias).toEqual([null, { lat: -34.17, lng: -70.74 }]);
  });

  it('con la otra carga cancelada, o con una sola, no es compartida', async () => {
    const cancelada = JUNTAS.map((f) =>
      f.tripId === 'viaje-b' ? { ...f, estado: 'cancelado' } : f,
    );
    expect(await pedir(cancelada)).toEqual({
      compartida: false,
      asignacionIds: ['asig-a'],
      paradasIntermedias: [],
    });
    expect((await pedir([fila(0, 'recogida', 'a'), fila(1, 'entrega', 'a')])).compartida).toBe(
      false,
    );
  });

  it('un servicio que no está en la ruta no tiene paradas intermedias', async () => {
    expect((await pedir(JUNTAS, 'viaje-z')).paradasIntermedias).toEqual([]);
  });
});
