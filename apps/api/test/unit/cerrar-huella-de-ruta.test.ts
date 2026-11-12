import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * huella-consolidada parte 4 (ADR-089): el cierre de la huella de una ruta con
 * varios servicios. Aquí se comprueba qué decide con cada medición; el cálculo
 * contra la base está en test/integration/huella-ruta-compartida.
 */
vi.mock('../../src/observability/business-metrics.js', () => ({
  getBusinessCounter: () => ({ add: vi.fn() }),
}));
const cargarRuta = vi.fn();
vi.mock('../../src/services/cargar-ruta.js', () => ({ cargarRuta }));
const medirVentanaDelVehiculo = vi.fn();
vi.mock('../../src/services/calcular-metricas-viaje.js', () => ({
  medirVentanaDelVehiculo,
  desgloseEmisiones: (e: { emisionesKgco2eTtw: number }) => ({
    emisionesKgco2eTtw: e.emisionesKgco2eTtw.toString(),
  }),
}));
const guardarHuellaDeRutaCompartida = vi.fn(async () => undefined);
vi.mock('../../src/services/huella-por-ruta.js', async (original) => ({
  ...(await original<typeof import('../../src/services/huella-por-ruta.js')>()),
  guardarHuellaDeRutaCompartida,
}));
const emitirCertificadoViaje = vi.fn();
vi.mock('../../src/services/emitir-certificado-viaje.js', () => ({ emitirCertificadoViaje }));

const { cerrarHuellaDeRuta, cerrarRutaYCertificar } = await import(
  '../../src/services/cerrar-huella-de-ruta.js'
);

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

const t = (minuto: number) => new Date(Date.UTC(2026, 10, 10, 10, minuto));
const servicio = (
  tripId: string,
  recogida: number | null,
  entrega: number | null,
  estado = 'entregado',
) => ({
  asignacionId: `asg-${tripId}`,
  tripId,
  estado,
  pickedUpAt: recogida === null ? null : t(recogida),
  deliveredAt: entrega === null ? null : t(entrega),
  cancelledAt: null,
});
const rutaCargada = (servicios: ReturnType<typeof servicio>[], extra: object = {}) => ({
  fila: {
    id: 'ruta-1',
    status: 'cerrada',
    vehicleId: 'veh-1',
    empresaId: 'emp-t',
    closedAt: t(9),
    ...extra,
  },
  servicios,
  paradas: [],
  ruta: {},
});
const VEHICULO = {
  id: 'veh-1',
  teltonikaImei: null,
  teltonikaImeiEspejo: null,
  fuelType: 'diesel',
  consumptionLPer100kmBaseline: '30.00',
  curbWeightKg: 6000,
  capacityKg: 5000,
  vehicleType: 'camion_mediano',
  capacidadEstanqueL: null,
  fuenteCombustibleCan: null,
};
const viaje = (id: string, pesoKg: number | null) => ({
  id,
  cargoWeightKg: pesoKg,
  generadorCargaEmpresaId: 'emp-g',
  carbonMeasurementOverride: null,
});
const metricas = (tripId: string, km: string | null) => ({
  tripId,
  distanceKmEstimated: km,
  precisionMethod: 'modelado',
});
const CON_HUELLA = [{ id: 'emp-t', carbonMeasurementEnabled: true }];
const SIN_HUELLA = [{ id: 'emp-t', carbonMeasurementEnabled: false }];
const DOS = [servicio('a', 0, 4), servicio('b', 2, 9)];
const medida = (extra: object = {}) => ({
  pings: [],
  escritura: { distanciaKmReal: 9, coveragePct: 100, kmCubiertos: 9 },
  abortReason: null,
  decision: null,
  columnasDecision: {},
  lee83: false,
  fuente: 'movil_gps',
  ...extra,
});
/** Las lecturas del cierre, en su orden: vehículo, viajes, métricas, empresas y métricas de la ruta. */
const lecturas = (opts: {
  vehiculo?: object | null;
  viajes?: unknown[];
  metricas?: unknown[];
  empresas?: unknown[];
}) => [
  opts.vehiculo === null ? [] : [opts.vehiculo ?? VEHICULO],
  opts.viajes ?? [viaje('a', 2000), viaje('b', 1000)],
  opts.metricas ?? [metricas('a', '10.00'), metricas('b', '6.00')],
  opts.empresas ?? CON_HUELLA,
  [],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cerrarHuellaDeRuta: cuándo no hay nada que cerrar', () => {
  it.each([
    ['ruta_no_encontrada', null],
    ['ruta_no_cerrada', rutaCargada(DOS, { status: 'en_curso' })],
    ['sin_servicios_recogidos', rutaCargada([servicio('a', null, null, 'cancelado')])],
  ])('%s', async (motivo, cargada) => {
    cargarRuta.mockResolvedValueOnce(cargada);
    const { db } = makeDb();
    expect(await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' })).toEqual({
      estado: 'omitida',
      motivo,
    });
    expect(medirVentanaDelVehiculo).not.toHaveBeenCalled();
  });

  it.each([
    ['la ruta no declara vehículo', rutaCargada(DOS, { vehicleId: null }), []],
    ['el vehículo ya no existe', rutaCargada(DOS), [[]]],
  ])('sin_vehiculo: %s', async (_caso, cargada, selects) => {
    cargarRuta.mockResolvedValueOnce(cargada);
    const { db } = makeDb(selects);
    expect(await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' })).toEqual({
      estado: 'omitida',
      motivo: 'sin_vehiculo',
    });
  });
});

describe('cerrarHuellaDeRuta: la ruta medida', () => {
  it('mide la ventana entre la primera recogida y la última entrega y reparte', async () => {
    cargarRuta.mockResolvedValueOnce(rutaCargada(DOS));
    medirVentanaDelVehiculo.mockResolvedValueOnce(medida());
    const { db, sets } = makeDb(lecturas({}));

    const r = await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1', routesProjectId: 'p' });

    expect(medirVentanaDelVehiculo).toHaveBeenCalledWith(
      expect.objectContaining({
        desde: t(0),
        hasta: t(9),
        pesoDeclarado: true,
        routesProjectId: 'p',
      }),
    );
    expect(r).toMatchObject({ estado: 'calculada', huella: 'medida', entregados: ['a', 'b'] });
    const guardado = guardarHuellaDeRutaCompartida.mock.calls[0]?.[1] as unknown as {
      momento: string;
      huella: {
        ruta: { emisionesKgco2eWtw: number; metodoPrecision: string };
        servicios: unknown[];
      };
      tripIds: string[];
      distanciaKmReal: number;
    };
    expect(guardado.momento).toBe('real');
    expect(guardado.tripIds).toEqual(['a', 'b']);
    expect(guardado.distanciaKmReal).toBe(9);
    expect(guardado.huella.servicios).toHaveLength(2);
    expect(guardado.huella.ruta.metodoPrecision).toBe('modelado');
    expect(r).toMatchObject({ emisionesKgco2e: guardado.huella.ruta.emisionesKgco2eWtw });
    // Una escritura por servicio; con varios, la distancia real queda en la ruta.
    expect(sets).toHaveLength(2);
    const partes = sets.map((s) => Number(s.carbonEmissionsKgco2eActual));
    expect(Math.round((partes[0] ?? 0) * 1000 + (partes[1] ?? 0) * 1000) / 1000).toBe(
      guardado.huella.ruta.emisionesKgco2eWtw,
    );
    for (const s of sets) {
      expect(s).toMatchObject({
        distanceKmActual: null,
        routeDataSource: 'movil_gps',
        coveragePct: '100',
        precisionMethod: 'modelado',
      });
    }
  });

  it('con combustible por CAN validado, la ruta sale de los litros medidos', async () => {
    cargarRuta.mockResolvedValueOnce(rutaCargada(DOS));
    medirVentanaDelVehiculo.mockResolvedValueOnce(
      medida({
        fuente: 'teltonika_gps',
        decision: { fuenteEnergia: 'can_83', litrosCan: 3.14 },
        columnasDecision: { fuenteEnergia: 'can_83' },
      }),
    );
    const { db, sets } = makeDb(lecturas({}));

    await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });

    const guardado = guardarHuellaDeRutaCompartida.mock.calls[0]?.[1] as unknown as {
      huella: { ruta: { metodoPrecision: string; combustibleConsumido: number } };
    };
    expect(guardado.huella.ruta).toMatchObject({
      metodoPrecision: 'exacto_canbus',
      combustibleConsumido: 3.1,
    });
    expect(sets[0]).toMatchObject({ fuenteEnergia: 'can_83', precisionMethod: 'exacto_canbus' });
  });

  it('un vehículo sin perfil de combustible se calcula por defecto', async () => {
    cargarRuta.mockResolvedValueOnce(rutaCargada(DOS));
    medirVentanaDelVehiculo.mockResolvedValueOnce(medida());
    const { db } = makeDb(
      lecturas({ vehiculo: { ...VEHICULO, fuelType: null, consumptionLPer100kmBaseline: null } }),
    );

    await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });

    const guardado = guardarHuellaDeRutaCompartida.mock.calls[0]?.[1] as unknown as {
      huella: { ruta: { metodoPrecision: string } };
    };
    expect(guardado.huella.ruta.metodoPrecision).toBe('por_defecto');
  });

  it('con un solo servicio recogido, ese servicio publica la distancia real', async () => {
    cargarRuta.mockResolvedValueOnce(
      rutaCargada([servicio('a', 0, 4), servicio('b', null, null, 'cancelado')]),
    );
    medirVentanaDelVehiculo.mockResolvedValueOnce(medida());
    const { db, sets } = makeDb(
      lecturas({ viajes: [viaje('a', 2000)], metricas: [metricas('a', '10.00')] }),
    );

    const r = await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });

    expect(r).toMatchObject({ huella: 'medida', entregados: ['a'] });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ distanceKmActual: '9' });
  });

  it('un servicio sin opt-in de huella no recibe cifras reales aunque la ruta se mida', async () => {
    cargarRuta.mockResolvedValueOnce(rutaCargada(DOS));
    medirVentanaDelVehiculo.mockResolvedValueOnce(medida());
    const { db, sets } = makeDb(
      lecturas({
        viajes: [viaje('a', 2000), { ...viaje('b', 1000), carbonMeasurementOverride: false }],
      }),
    );

    await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });

    expect(sets[0]).toHaveProperty('carbonEmissionsKgco2eActual');
    expect(sets[1]).not.toHaveProperty('carbonEmissionsKgco2eActual');
  });
});

describe('cerrarHuellaDeRuta: la ruta que no alcanza a medirse', () => {
  const sinCifras = async (
    huella: string,
    medicion: object,
    lecturasDelCaso: unknown[][],
    cargada = rutaCargada(DOS),
  ) => {
    cargarRuta.mockResolvedValueOnce(cargada);
    medirVentanaDelVehiculo.mockResolvedValueOnce(medicion);
    const { db, sets } = makeDb(lecturasDelCaso);
    const r = await cerrarHuellaDeRuta({ db, logger, rutaId: 'ruta-1' });
    expect(r).toMatchObject({ estado: 'calculada', huella, emisionesKgco2e: null });
    return sets;
  };

  it('sin distancia reconstruida: cifras reales en null y fuente de mapas', async () => {
    const sets = await sinCifras(
      'degradada_cobertura',
      medida({ escritura: null, abortReason: 'cap_exceeded' }),
      lecturas({}),
    );
    expect(guardarHuellaDeRutaCompartida.mock.calls[0]?.[1]).toMatchObject({
      momento: 'real',
      huella: null,
      distanciaKmReal: null,
    });
    for (const s of sets) {
      expect(s).toMatchObject({
        carbonEmissionsKgco2eActual: null,
        fuelConsumedLActual: null,
        emisionesKgco2eTtw: null,
        routeDataSource: 'maps_directions',
        coveragePct: '0',
      });
    }
  });

  it('cobertura bajo el umbral', async () => {
    await sinCifras(
      'degradada_cobertura',
      medida({ escritura: { distanciaKmReal: 9, coveragePct: 10, kmCubiertos: 0.9 } }),
      lecturas({}),
    );
  });

  it('un peso sin declarar', async () => {
    await sinCifras(
      'peso_ausente',
      medida(),
      lecturas({ viajes: [viaje('a', 2000), viaje('b', null)] }),
    );
    expect(medirVentanaDelVehiculo).toHaveBeenCalledWith(
      expect.objectContaining({ pesoDeclarado: false }),
    );
  });

  it('un servicio sin distancia directa', async () => {
    await sinCifras(
      'distancia_directa_ausente',
      medida(),
      lecturas({ metricas: [metricas('a', '10.00'), metricas('b', null)] }),
    );
  });

  it('sin opt-in pero con distancia real: guarda la distancia, la fuente y el nivel', async () => {
    const sets = await sinCifras('opt_in_inactivo', medida(), lecturas({ empresas: SIN_HUELLA }));
    expect(guardarHuellaDeRutaCompartida.mock.calls[0]?.[1]).toMatchObject({
      momento: 'nivel',
      huella: null,
      distanciaKmReal: 9,
    });
    expect(sets[0]).not.toHaveProperty('carbonEmissionsKgco2eActual');
  });

  it('sin opt-in y sin distancia real: solo registra la decisión de fuente', async () => {
    const sets = await sinCifras(
      'opt_in_inactivo',
      medida({
        escritura: null,
        abortReason: 'sin_observacion',
        decision: { fuenteEnergia: 'modelo', litrosCan: null },
        columnasDecision: { motivoFallback: 'sin_gps' },
      }),
      lecturas({ empresas: SIN_HUELLA }),
    );
    expect(sets).toEqual([{ motivoFallback: 'sin_gps' }]);
    expect(guardarHuellaDeRutaCompartida).not.toHaveBeenCalled();
  });

  it('sin opt-in, sin distancia real y sin decisión: no escribe nada', async () => {
    const sets = await sinCifras(
      'opt_in_inactivo',
      medida({ escritura: null, abortReason: 'routes_error' }),
      lecturas({ empresas: SIN_HUELLA }),
    );
    expect(sets).toEqual([]);
  });
});

describe('cerrarRutaYCertificar', () => {
  const EMITIDO = { skipped: false, pdfSha256: 'abc' };

  it('calcula la huella y emite un certificado por servicio entregado', async () => {
    cargarRuta.mockResolvedValueOnce(rutaCargada(DOS));
    medirVentanaDelVehiculo.mockResolvedValueOnce(medida());
    emitirCertificadoViaje.mockResolvedValue(EMITIDO);
    const { db } = makeDb(lecturas({}));

    const r = await cerrarRutaYCertificar({ db, logger, rutaId: 'ruta-1', config: {} });

    expect(r.certificados).toBe(2);
    expect(r.cierre).toMatchObject({ estado: 'calculada' });
    expect(emitirCertificadoViaje.mock.calls.map(([o]) => o.tripId)).toEqual(['a', 'b']);
  });

  it('si el cálculo falla, certifica igual a los entregados que lee de la base', async () => {
    cargarRuta.mockRejectedValueOnce(new Error('sin base'));
    const emitir = vi
      .fn()
      .mockResolvedValueOnce(EMITIDO)
      .mockResolvedValueOnce({ skipped: true, reason: 'already_issued' })
      .mockRejectedValueOnce(new Error('KMS caído'));
    const { db } = makeDb([[{ tripId: 'a' }, { tripId: 'b' }, { tripId: 'c' }]]);

    const r = await cerrarRutaYCertificar({ db, logger, rutaId: 'ruta-1', config: {}, emitir });

    expect(r).toEqual({ cierre: null, certificados: 1 });
    expect(emitir).toHaveBeenCalledTimes(3);
  });

  it('una ruta omitida no certifica más que lo entregado', async () => {
    cargarRuta.mockResolvedValueOnce(null);
    const emitir = vi.fn();
    const { db } = makeDb([[]]);

    const r = await cerrarRutaYCertificar({ db, logger, rutaId: 'ruta-1', config: {}, emitir });

    expect(r).toEqual({
      cierre: { estado: 'omitida', motivo: 'ruta_no_encontrada' },
      certificados: 0,
    });
    expect(emitir).not.toHaveBeenCalled();
  });
});
