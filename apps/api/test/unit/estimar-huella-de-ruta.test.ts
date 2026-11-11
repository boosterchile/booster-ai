import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * huella-consolidada §3.9: la estimación de una ruta abierta. Aquí se
 * comprueba qué decide con cada ruta; las cifras contra la base están en
 * test/integration/huella-ruta-compartida.
 */
const cargarRuta = vi.fn();
vi.mock('../../src/services/cargar-ruta.js', () => ({ cargarRuta }));
const obtenerDistanciaKm = vi.fn(async () => 40);
vi.mock('../../src/services/calcular-metricas-viaje.js', () => ({
  obtenerDistanciaKm,
  desgloseEmisiones: (e: { emisionesKgco2eTtw: number }) => ({
    emisionesKgco2eTtw: e.emisionesKgco2eTtw.toString(),
  }),
}));
const guardarHuellaDeRutaCompartida = vi.fn(async () => undefined);
vi.mock('../../src/services/huella-por-ruta.js', async (original) => ({
  ...(await original<typeof import('../../src/services/huella-por-ruta.js')>()),
  guardarHuellaDeRutaCompartida,
}));

const { estimarHuellaDeRuta } = await import('../../src/services/estimar-huella-de-ruta.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

function makeDb(selects: unknown[][] = []) {
  const cola = [...selects];
  const sets: Record<string, unknown>[] = [];
  const tx = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => cola.shift() ?? []),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn((valores: Record<string, unknown>) => {
        sets.push(valores);
        return { where: vi.fn(async () => []) };
      }),
    })),
  };
  const db = {
    ...tx,
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { db: db as never, sets };
}

const servicio = (tripId: string, estado = 'asignado') => ({
  asignacionId: `asg-${tripId}`,
  tripId,
  estado,
});
const parada = (tripId: string, tipo: 'recogida' | 'entrega') => ({
  id: `${tripId}-${tipo}`,
  tripId,
  tipo,
});
const ruta = (servicios: ReturnType<typeof servicio>[], extra: object = {}) => ({
  fila: { id: 'ruta-1', status: 'planificada', vehicleId: 'veh-1', ...extra },
  servicios,
  paradas: [
    ...servicios.map((s) => parada(s.tripId, 'recogida')),
    ...servicios.map((s) => parada(s.tripId, 'entrega')),
  ],
});
const viaje = (id: string, pesoKg: number | null, origen = `Origen ${id}`) => ({
  id,
  cargoWeightKg: pesoKg,
  origen,
  destino: `Destino ${id}`,
  origenRegion: 'RM',
  destinoRegion: 'V',
});
const directa = (tripId: string, km: string | null) => ({ tripId, distanceKmEstimated: km });
const VEHICULO = {
  fuelType: 'diesel',
  consumptionLPer100kmBaseline: '30.00',
  curbWeightKg: 6000,
  capacityKg: 5000,
  vehicleType: 'camion_mediano',
};
const DOS = [servicio('a'), servicio('b')];
const lecturasDeDos = (vehiculo: unknown[] = [VEHICULO]) => [
  [viaje('a', 2000), viaje('b', 1000)],
  [directa('a', '120.00'), directa('b', '30.00')],
  vehiculo,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('estimarHuellaDeRuta: cuándo no estima', () => {
  it.each([
    ['ruta_no_encontrada', null],
    ['ruta_no_vigente', ruta(DOS, { status: 'cerrada' })],
    ['ruta_no_vigente', ruta(DOS, { status: 'cancelada' })],
    ['sin_servicios', ruta([servicio('a', 'cancelado')])],
  ])('%s', async (motivo, cargada) => {
    cargarRuta.mockResolvedValueOnce(cargada);
    const { db, sets } = makeDb();
    expect(await estimarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' })).toEqual({
      estado: 'omitida',
      motivo,
    });
    expect(sets).toEqual([]);
  });

  it('falta la distancia directa de un servicio', async () => {
    cargarRuta.mockResolvedValueOnce(ruta(DOS));
    const { db, sets } = makeDb([
      [viaje('a', 2000), viaje('b', 1000)],
      [directa('a', '120.00'), directa('b', null)],
    ]);
    expect(await estimarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' })).toEqual({
      estado: 'omitida',
      motivo: 'distancia_directa_ausente',
    });
    expect(obtenerDistanciaKm).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });

  it('varios servicios y ninguno declara peso: no hay actividad que repartir', async () => {
    cargarRuta.mockResolvedValueOnce(ruta(DOS));
    const { db, sets } = makeDb([
      [viaje('a', null), viaje('b', null)],
      [directa('a', '120.00'), directa('b', '30.00')],
      [VEHICULO],
    ]);
    expect(await estimarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' })).toEqual({
      estado: 'omitida',
      motivo: 'sin_actividad',
    });
    expect(sets).toEqual([]);
  });
});

describe('estimarHuellaDeRuta: la ruta estimada', () => {
  it('pide la distancia de cada tramo y reparte la estimación', async () => {
    cargarRuta.mockResolvedValueOnce(ruta(DOS));
    const { db, sets } = makeDb(lecturasDeDos());

    const r = await estimarHuellaDeRuta({ db, logger, rutaId: 'ruta-1', routesProjectId: 'p' });

    // Cuatro paradas: tres tramos.
    expect(obtenerDistanciaKm).toHaveBeenCalledTimes(3);
    expect(obtenerDistanciaKm).toHaveBeenCalledWith(
      expect.objectContaining({
        origenDireccion: 'Origen a',
        destinoDireccion: 'Origen b',
        fuelType: 'diesel',
        routesProjectId: 'p',
      }),
    );
    const guardado = guardarHuellaDeRutaCompartida.mock.calls[0]?.[1] as unknown as {
      momento: string;
      huella: { ruta: { emisionesKgco2eWtw: number; distanciaKm: number } };
      tripIds: string[];
    };
    expect(guardado).toMatchObject({ momento: 'estimado', tripIds: ['a', 'b'] });
    expect(guardado.huella.ruta.distanciaKm).toBe(120);
    expect(r).toEqual({
      estado: 'estimada',
      rutaId: 'ruta-1',
      servicios: 2,
      emisionesKgco2e: guardado.huella.ruta.emisionesKgco2eWtw,
    });
    expect(sets).toHaveLength(2);
    const partes = sets.map((s) => Number(s.carbonEmissionsKgco2eEstimated));
    expect(Math.round(((partes[0] ?? 0) + (partes[1] ?? 0)) * 1000) / 1000).toBe(
      guardado.huella.ruta.emisionesKgco2eWtw,
    );
    for (const s of sets) {
      expect(s).toMatchObject({
        precisionMethod: 'modelado',
        routeDataSource: 'maps_directions',
        coveragePct: '0',
      });
      // La distancia directa y las cifras reales no se tocan.
      expect(s).not.toHaveProperty('distanceKmEstimated');
      expect(s).not.toHaveProperty('carbonEmissionsKgco2eActual');
    }
  });

  it('dos paradas en la misma dirección no piden distancia: el tramo mide 0', async () => {
    cargarRuta.mockResolvedValueOnce(ruta(DOS));
    const { db } = makeDb([
      [viaje('a', 2000, 'Bodega 1'), viaje('b', 1000, ' bodega 1 ')],
      [directa('a', '120.00'), directa('b', '30.00')],
      [VEHICULO],
    ]);

    await estimarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });

    expect(obtenerDistanciaKm).toHaveBeenCalledTimes(2);
    const guardado = guardarHuellaDeRutaCompartida.mock.calls[0]?.[1] as unknown as {
      huella: { ruta: { distanciaKm: number } };
    };
    expect(guardado.huella.ruta.distanciaKm).toBe(80);
  });

  it('con un servicio usa su distancia directa, sin consultar mapas', async () => {
    cargarRuta.mockResolvedValueOnce(ruta([servicio('a'), servicio('b', 'cancelado')]));
    const { db, sets } = makeDb([[viaje('a', 2000)], [directa('a', '120.00')], [VEHICULO]]);

    const r = await estimarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });

    expect(obtenerDistanciaKm).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: 'estimada', servicios: 1 });
    expect(sets).toHaveLength(1);
  });

  it.each([
    ['sin vehículo declarado', ruta(DOS, { vehicleId: null }), []],
    ['con un vehículo sin perfil de combustible', ruta(DOS), [{ ...VEHICULO, fuelType: null }]],
  ])('%s estima por defecto', async (_caso, cargada, vehiculo) => {
    cargarRuta.mockResolvedValueOnce(cargada);
    const selects = lecturasDeDos(vehiculo);
    const { db, sets } = makeDb(cargada.fila.vehicleId ? selects : selects.slice(0, 2));

    await estimarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });

    expect(sets[0]).toMatchObject({ precisionMethod: 'por_defecto' });
  });
});
