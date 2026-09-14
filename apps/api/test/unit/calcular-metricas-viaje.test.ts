import { calcularEmisionesViaje } from '@booster-ai/carbon-calculator';
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
// T12/T13: las métricas de negocio de la huella se capturan con spies (el meter
// real es no-op en tests y no deja rastro).
const { counterSpies } = vi.hoisted(() => ({
  counterSpies: new Map<string, { add: ReturnType<typeof vi.fn> }>(),
}));
vi.mock('../../src/observability/business-metrics.js', () => ({
  getBusinessCounter: vi.fn((name: string) => {
    let counter = counterSpies.get(name);
    if (!counter) {
      counter = { add: vi.fn() };
      counterSpies.set(name, counter);
    }
    return counter;
  }),
}));
// Mock PARCIAL: solo calcularCobertura. haversineKm y CONTINUITY_GAP_S quedan
// REALES — el híbrido (calcularDistanciaHibrida) los usa.
vi.mock('../../src/services/calcular-cobertura-telemetria.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/calcular-cobertura-telemetria.js')>()),
  calcularCobertura: vi.fn(),
}));
// T11: los pings salen de la fuente ruteada por vehículo (Task 10). Se mockea
// SOLO el resolver; `fuentePosicionSegmento` (clasificador puro) queda real para
// que la fuente persistida salga de la regla verdadera.
vi.mock('../../src/services/posicion-segmento.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/posicion-segmento.js')>()),
  resolverPosicionesSegmento: vi.fn(),
}));

const { computeRoutes } = await import('../../src/services/routes-api.js');
const { calcularCobertura, haversineKm } = await import(
  '../../src/services/calcular-cobertura-telemetria.js'
);
const { resolverPosicionesSegmento } = await import('../../src/services/posicion-segmento.js');

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

  it('vehículo SIN dispositivo → mide por posiciones del móvil y persiste movil_gps (secundario aunque cobertura 100 %)', async () => {
    (resolverPosicionesSegmento as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ]);
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: 'modelado' }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED, pickedUpAt: null }],
        [{ id: VEH_ID, teltonikaImei: null, teltonikaImeiEspejo: null }],
      ],
      updates: [[]],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(true);
    expect(result.routeDataSource).toBe('movil_gps');
    expect(result.certificationLevel).toBe('secundario_modeled');
    expect(result.kmCubiertos).toBeCloseTo(haversineKm(-33.4, -70.6, -33.41, -70.61), 6);
    const setArg = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock
      .calls[0][0];
    expect(setArg.routeDataSource).toBe('movil_gps');
    expect(setArg.certificationLevel).toBe('secundario_modeled');
    expect(resolverPosicionesSegmento).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle: { id: VEH_ID, teltonikaImei: null, teltonikaImeiEspejo: null },
      }),
    );
  });

  it('vehículo con solo IMEI espejo → teltonika_gps (lee el stream por imei)', async () => {
    (resolverPosicionesSegmento as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ]);
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: 'modelado' }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED, pickedUpAt: null }],
        [{ id: VEH_ID, teltonikaImei: null, teltonikaImeiEspejo: '860693084796730' }],
      ],
      updates: [[]],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.routeDataSource).toBe('teltonika_gps');
  });

  it('vehículo del assignment inexistente en BD → recomputed:false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100' }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED, pickedUpAt: null }],
        [],
      ],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
    expect(resolverPosicionesSegmento).not.toHaveBeenCalled();
  });

  it('VENTANA — anclada a assignments.recogido_en (recogida real), NO a pickup_window_start', async () => {
    const RECOGIDA_REAL = new Date('2026-05-01T11:15:00Z');
    (resolverPosicionesSegmento as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ]);
    const db = makeDb({
      selects: [
        [TRIP_BASE], // pickupWindowStart 10:00 (planificada)
        [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: 'modelado' }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED, pickedUpAt: RECOGIDA_REAL }],
        [{ id: VEH_ID, teltonikaImei: '999', teltonikaImeiEspejo: null }],
      ],
      updates: [[]],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      routesProjectId: 'proj',
    });
    expect(resolverPosicionesSegmento).toHaveBeenCalledWith(
      expect.objectContaining({ desde: RECOGIDA_REAL, hasta: ASSIGN_DELIVERED }),
    );
    expect(result.pickupAtSource).toBe('recogido_en');
  });

  // Nota: happy-path + interacción de cobertura los cubre el describe
  // "reconstrucción de distancia real" (abajo) con el resolver + Routes.

  it('precisionMethod null en metrics → default por_defecto (recomputa igual)', async () => {
    // Traza continua (sin huecos) → híbrida sin Routes → distancia persistida.
    (resolverPosicionesSegmento as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ]);
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: null }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED, pickedUpAt: null }],
        [{ id: VEH_ID, teltonikaImei: '999', teltonikaImeiEspejo: null }],
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

  it('sin recogido_en ni pickupWindowStart → la ventana cae a createdAt (fallback declarado)', async () => {
    (resolverPosicionesSegmento as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.41, lng: -70.61 },
    ]);
    const db = makeDb({
      selects: [
        [{ ...TRIP_BASE, pickupWindowStart: null }],
        [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: 'modelado' }],
        [{ vehicleId: VEH_ID, deliveredAt: ASSIGN_DELIVERED, pickedUpAt: null }],
        [{ id: VEH_ID, teltonikaImei: '999', teltonikaImeiEspejo: null }],
      ],
      updates: [[]],
    });
    const result = await recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      routesProjectId: 'proj',
    });
    expect(resolverPosicionesSegmento).toHaveBeenCalledWith(
      expect.objectContaining({ desde: TRIP_BASE.createdAt }),
    );
    expect(result.pickupAtSource).toBe('created_at');
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
    [{ vehicleId: VEH_ID, deliveredAt: DELIVERED, pickedUpAt: null }],
    [{ id: VEH_ID, teltonikaImei: '123456789012345', teltonikaImeiEspejo: null }],
  ];
  const run = (db: unknown) =>
    recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      routesProjectId: 'proj',
    } as never);

  it('ATOMICIDAD — distancia_km_real + coverage + nivel + uncertainty en UN solo UPDATE', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(pings(1));
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

  it('VALOR ESCRITO — persiste el híbrido (Σ observado + Σ hueco), NO la estimación', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(pings(1));
    (computeRoutes as Mock).mockResolvedValue(ruta(5));
    const db = makeDb({ selects: selectsTeltonika(), updates: [[]] });

    await run(db);

    const setArg = (db.update as Mock).mock.results[0].value.set.mock.calls[0][0];
    // `pings(1)` = 1 tramo observado (gap 30 s → haversine real) + 1 hueco
    // (gap 120 s → Routes, mockeado en 5 km). Lo persistido debe ser la SUMA:
    // descartar el hueco subestimaría (el error de backhaul que F0-0 corrige).
    const observadoKm = haversineKm(-33.4, -70.6, -33.41, -70.61);
    expect(Number(setArg.distanceKmActual)).toBeCloseTo(observadoKm + 5, 6);
    // Y NO la distancia estimada del trip (100 km): ése ES el bug F0-0 — con
    // 260k pings reales en la DB el certificado caía igual al fallback estimado.
    expect(Number(setArg.distanceKmActual)).not.toBeCloseTo(100, 6);
  });

  it('kmCubiertos en el resultado = Σ tramos observados (excluye los huecos estimados por Routes)', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(pings(1));
    (computeRoutes as Mock).mockResolvedValue(ruta(5));
    const db = makeDb({ selects: selectsTeltonika(), updates: [[]] });

    const res = await run(db);

    const observadoKm = haversineKm(-33.4, -70.6, -33.41, -70.61);
    expect(res.kmCubiertos).toBeCloseTo(observadoKm, 6);
    // La distancia persistida sí incluye el hueco; kmCubiertos es solo lo medido.
    expect(res.distanciaKmReal).toBeCloseTo(observadoKm + 5, 6);
    expect(res.routeDataSource).toBe('teltonika_gps');
  });

  it('IDEMPOTENCIA — dos corridas sobre los mismos pings convergen al mismo UPDATE', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValue(pings(1));
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
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(pings(2));
    (computeRoutes as Mock).mockRejectedValue(new Error('Routes 503'));
    const db = makeDb({ selects: selectsTeltonika() });

    const res = await run(db);

    expect(res.recomputed).toBe(false);
    expect(res.abortReason).toBe('routes_error');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('ABORT (cap superado) — no-op, abortReason=cap_exceeded, SIN llamar a Routes', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(pings(MAX_HUECOS_ROUTES + 1));
    const db = makeDb({ selects: selectsTeltonika() });

    const res = await run(db);

    expect(res.abortReason).toBe('cap_exceeded');
    expect(computeRoutes).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('ABORT (sin observación continua) — no-op, abortReason=sin_observacion (no aplica ≠ roto)', async () => {
    // todos los tramos son huecos → kmObservado 0 → no hay distancia medida.
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce([
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

describe('recalcularNivelPostEntrega — huella real del segmento (T12) + peso ausente (T13)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  const DELIVERED = new Date('2026-05-01T15:00:00Z');
  const RECOGIDA = new Date('2026-05-01T11:00:00Z');
  const EMP_TRANSPORTISTA = '44444444-4444-4444-4444-444444444444';
  const EMP_GENERADOR = '55555555-5555-5555-5555-555555555555';
  const VEH_MODELADO = {
    id: VEH_ID,
    teltonikaImei: '123456789012345',
    teltonikaImeiEspejo: null,
    fuelType: 'diesel',
    consumptionLPer100kmBaseline: '28.50',
    curbWeightKg: 7000,
    capacityKg: 12000,
    vehicleType: 'camion_mediano',
  };
  const ruta = (km: number) => [
    { distanceKm: km, durationS: 100, fuelL: null, polylineEncoded: '' },
  ];
  const continuos = () => [
    { tMs: 0, lat: -33.4, lng: -70.6 },
    { tMs: 30_000, lat: -33.41, lng: -70.61 },
  ];
  const kmContinuo = haversineKm(-33.4, -70.6, -33.41, -70.61);
  // 1 tramo observado + 1 hueco de 120 s (Routes lo estima).
  const conHueco = () => [...continuos(), { tMs: 150_000, lat: -33.6, lng: -70.8 }];
  // Sin observación continua: todos los tramos son huecos.
  const soloHuecos = () => [
    { tMs: 0, lat: -33.4, lng: -70.6 },
    { tMs: 120_000, lat: -33.42, lng: -70.62 },
  ];

  const selects = (
    o: {
      trip?: Record<string, unknown>;
      metrics?: Record<string, unknown>;
      assignment?: Record<string, unknown>;
      vehicle?: Record<string, unknown>;
      empresas?: unknown[];
    } = {},
  ) => [
    [{ ...TRIP_BASE, generadorCargaEmpresaId: null, carbonMeasurementOverride: null, ...o.trip }],
    [{ tripId: TRIP_ID, distanceKmEstimated: '100', precisionMethod: 'modelado', ...o.metrics }],
    [
      {
        vehicleId: VEH_ID,
        deliveredAt: DELIVERED,
        pickedUpAt: RECOGIDA,
        empresaId: EMP_TRANSPORTISTA,
        ...o.assignment,
      },
    ],
    [{ ...VEH_MODELADO, ...o.vehicle }],
    o.empresas ?? [{ id: EMP_TRANSPORTISTA, carbonMeasurementEnabled: true }],
  ];
  const run = (db: unknown) =>
    recalcularNivelPostEntrega({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      routesProjectId: 'proj',
    });
  const setDe = (db: ReturnType<typeof makeDb>) =>
    (db.update as Mock).mock.results[0].value.set.mock.calls[0][0];
  const counter = (name: string) => counterSpies.get(name);
  const emisionesEsperadas = (distanciaKm: number, cargaKg = 5000) =>
    calcularEmisionesViaje({
      metodo: 'modelado',
      distanciaKm,
      cargaKg,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 28.5,
        pesoVacioKg: 7000,
        capacidadKg: 12000,
      },
    });

  beforeEach(() => {
    for (const c of counterSpies.values()) {
      c.add.mockClear();
    }
  });

  it('opt-in inactivo (sin override, empresas sin flag) → NO computa emisiones reales; distancia y nivel como T11', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(continuos());
    const db = makeDb({
      selects: selects({ empresas: [{ id: EMP_TRANSPORTISTA, carbonMeasurementEnabled: false }] }),
      updates: [[]],
    });
    const res = await run(db);
    expect(res.recomputed).toBe(true);
    expect(res.huella).toBe('opt_in_inactivo');
    const setArg = setDe(db);
    expect(setArg.distanceKmActual).toBeDefined();
    expect(setArg.carbonEmissionsKgco2eActual).toBeUndefined();
    expect(counter('huella_segmento_total')?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ resultado: 'opt_in_inactivo', fuente: 'teltonika_gps' }),
    );
  });

  it('MEDIDA — opt-in del transportista + cobertura ≥ 80 % → emisiones reales GLEC desde la distancia real del segmento (perfil modelado), nunca 0', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(continuos());
    const db = makeDb({ selects: selects(), updates: [[]] });
    const res = await run(db);
    const esperado = emisionesEsperadas(kmContinuo);
    expect(res.huella).toBe('medida');
    expect(res.emisionesKgco2eReales).toBeCloseTo(esperado.emisionesKgco2eWtw, 6);
    const setArg = setDe(db);
    expect(Number(setArg.carbonEmissionsKgco2eActual)).toBeCloseTo(esperado.emisionesKgco2eWtw, 3);
    expect(Number(setArg.carbonEmissionsKgco2eActual)).toBeGreaterThan(0);
    expect(Number(setArg.fuelConsumedLActual)).toBeCloseTo(esperado.combustibleConsumido, 2);
    expect(setArg.precisionMethod).toBe('modelado');
    expect(setArg.routeDataSource).toBe('teltonika_gps');
    expect(Number(setArg.distanceKmActual)).toBeCloseTo(kmContinuo, 6);
    expect(counter('huella_segmento_total')?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ resultado: 'medida', fuente: 'teltonika_gps' }),
    );
  });

  it('la distancia que alimenta la huella es la MISMA que se persiste (híbrida = observado + huecos), no solo lo observado', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(conHueco());
    // hueco pequeño (0,2 km) → cobertura ≈ 88 % ≥ 80 → medida.
    (computeRoutes as Mock).mockResolvedValue(ruta(0.2));
    const db = makeDb({ selects: selects(), updates: [[]] });
    const res = await run(db);
    expect(res.huella).toBe('medida');
    const setArg = setDe(db);
    const distanciaPersistida = Number(setArg.distanceKmActual);
    expect(distanciaPersistida).toBeCloseTo(kmContinuo + 0.2, 6);
    expect(Number(setArg.carbonEmissionsKgco2eActual)).toBeCloseTo(
      emisionesEsperadas(distanciaPersistida).emisionesKgco2eWtw,
      3,
    );
  });

  it('override del viaje = true gana aunque ninguna empresa tenga el flag', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(continuos());
    const db = makeDb({
      selects: selects({
        trip: { carbonMeasurementOverride: true },
        empresas: [{ id: EMP_TRANSPORTISTA, carbonMeasurementEnabled: false }],
      }),
      updates: [[]],
    });
    const res = await run(db);
    expect(res.huella).toBe('medida');
  });

  it('override del viaje = false gana aunque el transportista tenga el flag', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(continuos());
    const db = makeDb({
      selects: selects({ trip: { carbonMeasurementOverride: false } }),
      updates: [[]],
    });
    const res = await run(db);
    expect(res.huella).toBe('opt_in_inactivo');
  });

  it('el opt-in del generador (trips.generadorCargaEmpresaId) también activa la medición', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(continuos());
    const db = makeDb({
      selects: selects({
        trip: { generadorCargaEmpresaId: EMP_GENERADOR },
        empresas: [
          { id: EMP_GENERADOR, carbonMeasurementEnabled: true },
          { id: EMP_TRANSPORTISTA, carbonMeasurementEnabled: false },
        ],
      }),
      updates: [[]],
    });
    const res = await run(db);
    expect(res.huella).toBe('medida');
  });

  it('DEGRADACIÓN (corte #2) — cobertura < 80 % → emisiones reales null + métrica; la distancia híbrida (#624) y su fuente se conservan', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(conHueco());
    // hueco grande (40 km) → cobertura ≈ 3,6 % < 80.
    (computeRoutes as Mock).mockResolvedValue(ruta(40));
    const db = makeDb({ selects: selects(), updates: [[]] });
    const res = await run(db);
    expect(res.huella).toBe('degradada_cobertura');
    expect(res.emisionesKgco2eReales).toBeNull();
    const setArg = setDe(db);
    expect(Number(setArg.distanceKmActual)).toBeCloseTo(kmContinuo + 40, 6);
    expect(setArg.carbonEmissionsKgco2eActual).toBeNull();
    expect(setArg.routeDataSource).toBe('teltonika_gps');
    expect(setArg.certificationLevel).toBe('secundario_modeled');
    expect(Number(setArg.coveragePct)).toBeLessThan(80);
    expect(counter('huella_cobertura_degradada_total')?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ fuente: 'teltonika_gps', motivo: 'cobertura_bajo_umbral' }),
    );
  });

  it('DEGRADACIÓN sin observación continua (opt-in activo) → queda REGISTRADA en BD (maps_directions + *Actual null), no en silencio', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(soloHuecos());
    (computeRoutes as Mock).mockResolvedValue(ruta(5));
    const db = makeDb({ selects: selects(), updates: [[]] });
    const res = await run(db);
    expect(res.abortReason).toBe('sin_observacion');
    expect(res.huella).toBe('degradada_cobertura');
    expect(db.update).toHaveBeenCalledTimes(1);
    const setArg = setDe(db);
    expect(setArg.routeDataSource).toBe('maps_directions');
    expect(setArg.distanceKmActual).toBeNull();
    expect(setArg.carbonEmissionsKgco2eActual).toBeNull();
    expect(Number(setArg.coveragePct)).toBe(0);
    expect(counter('huella_cobertura_degradada_total')?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ motivo: 'sin_observacion' }),
    );
  });

  it('sin observación con opt-in INACTIVO → sigue sin UPDATE (comportamiento T11 intacto)', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(soloHuecos());
    const db = makeDb({
      selects: selects({ empresas: [{ id: EMP_TRANSPORTISTA, carbonMeasurementEnabled: false }] }),
    });
    const res = await run(db);
    expect(res.abortReason).toBe('sin_observacion');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('PESO AUSENTE (T13) — opt-in activo + cobertura alta → emisiones reales null + métrica huella_peso_ausente; la distancia medida SÍ se persiste', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(continuos());
    const db = makeDb({ selects: selects({ trip: { cargoWeightKg: null } }), updates: [[]] });
    const res = await run(db);
    expect(res.huella).toBe('peso_ausente');
    expect(res.emisionesKgco2eReales).toBeNull();
    const setArg = setDe(db);
    expect(setArg.carbonEmissionsKgco2eActual).toBeNull();
    expect(Number(setArg.distanceKmActual)).toBeCloseTo(kmContinuo, 6);
    expect(setArg.routeDataSource).toBe('teltonika_gps');
    expect(counter('huella_peso_ausente_total')?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ fuente: 'teltonika_gps' }),
    );
  });

  it('perfil incompleto (sin consumo base) → mide en por_defecto con el tipo de vehículo', async () => {
    (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(continuos());
    const db = makeDb({
      selects: selects({ vehicle: { consumptionLPer100kmBaseline: null } }),
      updates: [[]],
    });
    const res = await run(db);
    expect(res.huella).toBe('medida');
    const setArg = setDe(db);
    expect(setArg.precisionMethod).toBe('por_defecto');
    expect(Number(setArg.carbonEmissionsKgco2eActual)).toBeGreaterThan(0);
  });

  it('INVARIANTE — en ningún camino degradado emisiones_kgco2e_reales es 0: siempre null', async () => {
    const casos: Array<{ pings: () => unknown[]; km: number; trip?: Record<string, unknown> }> = [
      { pings: conHueco, km: 40 },
      { pings: soloHuecos, km: 5 },
      { pings: continuos, km: 5, trip: { cargoWeightKg: null } },
    ];
    for (const caso of casos) {
      (resolverPosicionesSegmento as Mock).mockResolvedValueOnce(caso.pings());
      (computeRoutes as Mock).mockResolvedValue(ruta(caso.km));
      const db = makeDb({ selects: selects({ trip: caso.trip ?? {} }), updates: [[]] });
      await run(db);
      const setArg = setDe(db);
      expect(setArg.carbonEmissionsKgco2eActual, JSON.stringify(caso.trip)).toBeNull();
      expect(setArg.carbonEmissionsKgco2eActual).not.toBe('0');
    }
  });
});
