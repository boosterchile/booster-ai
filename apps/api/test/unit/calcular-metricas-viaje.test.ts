import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_HUECOS_ROUTES } from '../../src/services/calcular-distancia-real.js';
import {
  TripNotFoundError,
  calcularMetricasEstimadas,
  recalcularNivelPostEntrega,
} from '../../src/services/calcular-metricas-viaje.js';

vi.mock('../../src/services/routes-api.js', () => ({
  computeRoutes: vi.fn(),
}));
// Mock PARCIAL: solo calcularCobertura + cargarPingsVentana. haversineKm y
// CONTINUITY_GAP_S quedan REALES — el híbrido (calcularDistanciaHibrida) los usa.
vi.mock('../../src/services/calcular-cobertura-telemetria.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/calcular-cobertura-telemetria.js')>()),
  calcularCobertura: vi.fn(),
  cargarPingsVentana: vi.fn(),
}));

const { computeRoutes } = await import('../../src/services/routes-api.js');
const { calcularCobertura, cargarPingsVentana } = await import(
  '../../src/services/calcular-cobertura-telemetria.js'
);

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  inserts?: unknown[][];
  updates?: unknown[][];
}

/**
 * Mock de db.transaction(cb) + tx.select/insert/update con cadenas
 * fluent thenable. La transaction simplemente invoca el callback con
 * el mismo tx y devuelve su valor (no hay rollback en mock).
 */
function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];
  const updates = [...(opts.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(async () => inserts.shift() ?? []),
  });

  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => updates.shift() ?? []),
    })),
  });

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
    update: vi.fn(() => buildUpdateChain()),
  };

  return {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const VEH_ID = '22222222-2222-2222-2222-222222222222';

const TRIP_BASE = {
  id: TRIP_ID,
  cargoWeightKg: 5000,
  originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
  destinationAddressRaw: 'Plaza Sotomayor, Valparaíso',
  originRegionCode: 'RM',
  destinationRegionCode: 'V',
  pickupWindowStart: new Date('2026-05-01T10:00:00Z'),
  createdAt: new Date('2026-05-01T09:00:00Z'),
};

describe('calcularMetricasEstimadas', () => {
  it('throw TripNotFoundError si trip no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      calcularMetricasEstimadas({
        db: db as never,
        logger: noopLogger,
        tripId: TRIP_ID,
        vehicleId: null,
      }),
    ).rejects.toThrow(TripNotFoundError);
  });

  it('vehicleId=null → modo por_defecto camion_mediano + INSERT initial', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE], // SELECT trip
        [], // SELECT existing tripMetrics → vacío
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.tripId).toBe(TRIP_ID);
    expect(result.isInitialCalculation).toBe(true);
    expect(result.emisiones.metodoPrecision).toBe('por_defecto');
    expect(result.emisiones.emisionesKgco2eWtw).toBeGreaterThan(0);
  });

  it('vehículo con perfil completo → modo modelado', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [
          {
            id: VEH_ID,
            fuelType: 'diesel_b5',
            consumptionLPer100kmBaseline: '28.5',
            curbWeightKg: 7000,
            capacityKg: 12000,
            vehicleType: 'camion_pequeno',
          },
        ],
        [], // tripMetrics existing vacío
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    expect(result.emisiones.metodoPrecision).toBe('modelado');
    expect(result.isInitialCalculation).toBe(true);
  });

  it('vehículo con perfil completo + carga → persiste empty backhaul fields (ADR-021)', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [
          {
            id: VEH_ID,
            // 'diesel' es TipoCombustible válido del carbon-calculator.
            fuelType: 'diesel',
            consumptionLPer100kmBaseline: '28.5',
            curbWeightKg: 7000,
            capacityKg: 12000,
            vehicleType: 'camion_pequeno',
          },
        ],
        [],
      ],
      inserts: [[]],
    });

    await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    // El INSERT debió recibir los 3 campos backhaul con valores ≥ 0.
    const insertCall = (db.insert as ReturnType<typeof vi.fn>).mock.results.find((r) => r.value);
    expect(insertCall).toBeDefined();
    const values = (insertCall?.value as { values: ReturnType<typeof vi.fn> }).values.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(values.factorMatchingAplicado).toBe('0.00');
    expect(typeof values.emisionesEmptyBackhaulKgco2eWtw).toBe('string');
    expect(Number(values.emisionesEmptyBackhaulKgco2eWtw)).toBeGreaterThan(0);
    // Con factorMatching=0 el ahorro vs sin-matching es 0 (peor caso).
    expect(values.ahorroCo2eVsSinMatchingKgco2e).toBe('0');
  });

  it('vehículo en modo por_defecto → backhaul fields quedan null', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [
          {
            id: VEH_ID,
            fuelType: null,
            consumptionLPer100kmBaseline: null,
            curbWeightKg: null,
            capacityKg: null,
            vehicleType: 'camion_pequeno',
          },
        ],
        [],
      ],
      inserts: [[]],
    });

    await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    const insertCall = (db.insert as ReturnType<typeof vi.fn>).mock.results.find((r) => r.value);
    const values = (insertCall?.value as { values: ReturnType<typeof vi.fn> }).values.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(values.factorMatchingAplicado).toBeNull();
    expect(values.emisionesEmptyBackhaulKgco2eWtw).toBeNull();
    expect(values.ahorroCo2eVsSinMatchingKgco2e).toBeNull();
  });

  it('vehículo SIN perfil completo (falta consumo) → cae a modo por_defecto', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [
          {
            id: VEH_ID,
            fuelType: 'diesel_b5',
            consumptionLPer100kmBaseline: null, // falta perfil
            curbWeightKg: null,
            capacityKg: 12000,
            vehicleType: 'camion_pequeno',
          },
        ],
        [],
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    expect(result.emisiones.metodoPrecision).toBe('por_defecto');
  });

  it('vehicleId no encontrado en BD → fallback por_defecto camion_mediano', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [], // SELECT vehicles vacío
        [],
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    expect(result.emisiones.metodoPrecision).toBe('por_defecto');
  });

  it('tripMetrics ya existe → UPDATE, isInitialCalculation=false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID }], // tripMetrics existente
      ],
      updates: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.isInitialCalculation).toBe(false);
    expect(db.update).toHaveBeenCalled();
  });

  it('cargo_weight_kg null → trata como 0', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, cargoWeightKg: null }], []],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.emisiones.distanciaKm).toBeGreaterThan(0);
  });

  it('region codes null → distancia default 500 km usado en cálculo', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, originRegionCode: null, destinationRegionCode: null }], []],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.emisiones.distanciaKm).toBe(500);
  });
});

describe('calcularMetricasEstimadas — Routes API integration', () => {
  it('routesApiKey + ruta válida → usa distancia de Routes API', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 137.4, durationS: 6000, fuelL: 30, polylineEncoded: 'p' },
    ]);
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [
          {
            id: VEH_ID,
            fuelType: 'diesel',
            consumptionLPer100kmBaseline: '28.5',
            curbWeightKg: 7000,
            capacityKg: 12000,
            vehicleType: 'camion_pequeno',
          },
        ],
        [],
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
      routesProjectId: 'test-project',
    });

    expect(result.emisiones.distanciaKm).toBe(137.4);
    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'test-project',
        emissionType: 'DIESEL',
      }),
    );
  });

  it('routesApiKey pero Routes API throw → fallback a estimarDistanciaKm', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota'));
    const db = makeDb({
      selects: [[TRIP_BASE], []],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
      routesProjectId: 'test-project',
    });

    expect(result.emisiones.distanciaKm).toBeGreaterThan(0);
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it('Routes API devuelve [] → fallback', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const db = makeDb({
      selects: [[TRIP_BASE], []],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
      routesProjectId: 'test-project',
    });

    expect(result.emisiones.distanciaKm).toBeGreaterThan(0);
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it('Routes API devuelve route con distanceKm=0 → fallback', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 0, durationS: 0, fuelL: null, polylineEncoded: '' },
    ]);
    const db = makeDb({
      selects: [[TRIP_BASE], []],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
      routesProjectId: 'test-project',
    });

    expect(result.emisiones.distanciaKm).toBeGreaterThan(0);
  });

  it('mapFuelToEmissionType: cubre branches gasolina/glp/electrico/hibrido', async () => {
    const fuelCases = [
      'gasolina',
      'gas_glp',
      'gas_gnc',
      'electrico',
      'hidrogeno',
      'hibrido_diesel',
      'hibrido_gasolina',
    ];
    for (const fuel of fuelCases) {
      (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { distanceKm: 50, durationS: 3000, fuelL: 5, polylineEncoded: 'p' },
      ]);
      const db = makeDb({
        selects: [
          [TRIP_BASE],
          [
            {
              id: VEH_ID,
              fuelType: fuel,
              consumptionLPer100kmBaseline: '20',
              curbWeightKg: 5000,
              capacityKg: 10000,
              vehicleType: 'camion_pequeno',
            },
          ],
          [],
        ],
        inserts: [[]],
      });
      await calcularMetricasEstimadas({
        db: db as never,
        logger: noopLogger,
        tripId: TRIP_ID,
        vehicleId: VEH_ID,
        routesProjectId: 'test-project',
      });
    }
    expect(computeRoutes).toHaveBeenCalledTimes(fuelCases.length);
  });
});

describe('recalcularNivelPostEntrega', () => {
  const ASSIGN_DELIVERED = new Date('2026-05-01T15:00:00Z');

  beforeEach(() => {
    (calcularCobertura as ReturnType<typeof vi.fn>).mockReset();
  });

  it('throw TripNotFoundError si trip no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      recalcularNivelPostEntrega({
        db: db as never,
        logger: noopLogger,
        tripId: TRIP_ID,
      }),
    ).rejects.toThrow(TripNotFoundError);
  });

  it('sin tripMetrics previos → log warn + recomputed:false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE], // trip exists
        [], // no metrics
      ],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it('sin assignment con vehicleId+deliveredAt → recomputed:false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100' }],
        [], // no assignment
      ],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
  });

  it('assignment sin vehicleId → recomputed:false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100' }],
        [{ vehicleId: null, deliveredAt: ASSIGN_DELIVERED }],
      ],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
  });

  it('vehículo sin Teltonika → no recomputa, log info', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100' }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED }],
        [{ teltonikaImei: null }],
      ],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
    expect(calcularCobertura).not.toHaveBeenCalled();
  });

  // Nota: happy-path + interacción de cobertura ahora los cubre el describe
  // "reconstrucción de distancia real" (abajo) con cargarPingsVentana + Routes.

  it('precisionMethod null en metrics → default por_defecto (recomputa igual)', async () => {
    // Traza continua (sin huecos) → híbrida sin Routes → distancia persistida.
    (cargarPingsVentana as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ]);
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: null }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED }],
        [{ teltonikaImei: '999' }],
      ],
      updates: [[]],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      routesProjectId: 'proj',
    });
    expect(result.recomputed).toBe(true);
  });

  it('trip sin pickupWindowStart → cargarPingsVentana usa createdAt', async () => {
    (cargarPingsVentana as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ]);
    const db = makeDb({
      selects: [
        [{ ...TRIP_BASE, pickupWindowStart: null }],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: 'modelado' }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED }],
        [{ teltonikaImei: '999' }],
      ],
      updates: [[]],
    });
    await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      routesProjectId: 'proj',
    });
    expect(cargarPingsVentana).toHaveBeenCalledWith(
      expect.objectContaining({ pickupAt: TRIP_BASE.createdAt }),
    );
  });
});

describe('recalcularNivelPostEntrega — reconstrucción de distancia real (F0-0 paso 1)', () => {
  const DELIVERED = new Date('2026-05-01T15:00:00Z');
  type Mock = ReturnType<typeof vi.fn>;
  const ruta = (km: number) => [
    { distanceKm: km, durationS: 100, fuelL: null, polylineEncoded: '' },
  ];

  // 1 tramo observado (gap 30s) + `huecos` tramos con gap ≥60s.
  const pings = (huecos: number) => {
    const arr = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ];
    let t = 30_000;
    let lat = -33.41;
    for (let i = 0; i < huecos; i++) {
      t += 120_000;
      lat -= 0.02;
      arr.push({ tMs: t, lat, lng: -70.61 });
    }
    return arr;
  };
  const selectsTeltonika = () => [
    [TRIP_BASE],
    [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: 'modelado' }],
    [{ vehicleId: VEH_ID, deliveredAt: DELIVERED }],
    [{ teltonikaImei: '123456789012345' }],
  ];
  const run = (db: unknown) =>
    recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      routesProjectId: 'proj',
    } as never);

  it('ATOMICIDAD — distancia_km_real + coverage + nivel + uncertainty en UN solo UPDATE', async () => {
    (cargarPingsVentana as Mock).mockResolvedValueOnce(pings(1));
    (computeRoutes as Mock).mockResolvedValue(ruta(5));
    const db = makeDb({ selects: selectsTeltonika(), updates: [[]] });

    const res = await run(db);

    expect(res.recomputed).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
    const setArg = (db.update as Mock).mock.results[0].value.set.mock.calls[0][0];
    // todo-o-nada: los cuatro campos + procedencia en el MISMO set.
    expect(setArg.distanceKmActual).not.toBeNull();
    expect(setArg.distanceKmActual).not.toBeUndefined();
    expect(setArg.coveragePct).not.toBeUndefined();
    expect(setArg.certificationLevel).not.toBeUndefined();
    expect(setArg.uncertaintyFactor).not.toBeUndefined();
    expect(setArg.routeDataSource).toBe('teltonika_gps');
  });

  it('IDEMPOTENCIA — dos corridas sobre los mismos pings convergen al mismo UPDATE', async () => {
    (cargarPingsVentana as Mock).mockResolvedValue(pings(1));
    (computeRoutes as Mock).mockResolvedValue(ruta(5));

    const db1 = makeDb({ selects: selectsTeltonika(), updates: [[]] });
    await run(db1);
    const db2 = makeDb({ selects: selectsTeltonika(), updates: [[]] });
    await run(db2);

    const s1 = (db1.update as Mock).mock.results[0].value.set.mock.calls[0][0];
    const s2 = (db2.update as Mock).mock.results[0].value.set.mock.calls[0][0];
    expect(s1.distanceKmActual).toBe(s2.distanceKmActual);
    expect(s1.coveragePct).toBe(s2.coveragePct);
    expect(s1.certificationLevel).toBe(s2.certificationLevel);
    expect(s1.uncertaintyFactor).toBe(s2.uncertaintyFactor);
  });

  it('ABORT (Routes caído) — no-op, abortReason=routes_error, SIN UPDATE (cae a estimación)', async () => {
    (cargarPingsVentana as Mock).mockResolvedValueOnce(pings(2));
    (computeRoutes as Mock).mockRejectedValue(new Error('Routes 503'));
    const db = makeDb({ selects: selectsTeltonika() });

    const res = await run(db);

    expect(res.recomputed).toBe(false);
    expect(res.abortReason).toBe('routes_error');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('ABORT (cap superado) — no-op, abortReason=cap_exceeded, SIN llamar a Routes', async () => {
    (cargarPingsVentana as Mock).mockResolvedValueOnce(pings(MAX_HUECOS_ROUTES + 1));
    const db = makeDb({ selects: selectsTeltonika() });

    const res = await run(db);

    expect(res.abortReason).toBe('cap_exceeded');
    expect(computeRoutes).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('ABORT (sin observación continua) — no-op, abortReason=sin_observacion (no aplica ≠ roto)', async () => {
    // todos los tramos son huecos → kmObservado 0 → no hay distancia medida.
    (cargarPingsVentana as Mock).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 120_000, lat: -33.42, lng: -70.62 },
    ]);
    (computeRoutes as Mock).mockResolvedValue(ruta(5));
    const db = makeDb({ selects: selectsTeltonika() });

    const res = await run(db);

    expect(res.abortReason).toBe('sin_observacion');
    expect(db.update).not.toHaveBeenCalled();
  });
});
