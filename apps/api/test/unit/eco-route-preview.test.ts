import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OfferForbiddenForPreviewError,
  OfferNotFoundForPreviewError,
  generarEcoPreview,
} from '../../src/services/eco-route-preview.js';

vi.mock('../../src/services/routes-api.js', () => ({
  computeRoutes: vi.fn(),
}));

const { computeRoutes } = await import('../../src/services/routes-api.js');

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
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  return {
    select: vi.fn(() => buildSelectChain()),
  };
}

const OFFER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const VEH_ID = '33333333-3333-3333-3333-333333333333';
const EMPRESA_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_EMPRESA_ID = '55555555-5555-5555-5555-555555555555';

const TRIP_BASE = {
  id: TRIP_ID,
  cargoWeightKg: 5000,
  originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
  destinationAddressRaw: 'Plaza Sotomayor, Valparaíso',
  originRegionCode: 'RM',
  destinationRegionCode: 'V',
};

const VEHICLE_DIESEL_FULL = {
  id: VEH_ID,
  fuelType: 'diesel',
  consumptionLPer100kmBaseline: '28.5',
  curbWeightKg: 7000,
  capacityKg: 12000,
  vehicleType: 'camion_pequeno',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('generarEcoPreview — ownership y not found', () => {
  it('throw OfferNotFoundForPreviewError si no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      generarEcoPreview({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
      }),
    ).rejects.toThrow(OfferNotFoundForPreviewError);
  });

  it('throw OfferForbiddenForPreviewError si la oferta es de otra empresa', async () => {
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: OTHER_EMPRESA_ID, suggestedVehicleId: null },
            trip: TRIP_BASE,
            vehicle: null,
          },
        ],
      ],
    });
    await expect(
      generarEcoPreview({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
      }),
    ).rejects.toThrow(OfferForbiddenForPreviewError);
  });
});

describe('generarEcoPreview — fallback (sin routesApiKey)', () => {
  it('sin vehículo → modo por_defecto + tabla_chile + camion_mediano', async () => {
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: null },
            trip: TRIP_BASE,
            vehicle: null,
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
    });

    expect(result.tripId).toBe(TRIP_ID);
    expect(result.suggestedVehicleId).toBeNull();
    expect(result.dataSource).toBe('tabla_chile');
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationS).toBeNull();
    expect(result.fuelLitersEstimated).toBeNull();
    expect(result.precisionMethod).toBe('por_defecto');
    expect(result.emisionesKgco2eWtw).toBeGreaterThan(0);
    expect(computeRoutes).not.toHaveBeenCalled();
  });

  it('vehículo con perfil completo → modo modelado', async () => {
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: VEH_ID },
            trip: TRIP_BASE,
            vehicle: VEHICLE_DIESEL_FULL,
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
    });

    expect(result.precisionMethod).toBe('modelado');
    expect(result.suggestedVehicleId).toBe(VEH_ID);
    expect(result.dataSource).toBe('tabla_chile');
  });

  it('vehículo SIN consumo declarado → cae a por_defecto con vehicleType', async () => {
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: VEH_ID },
            trip: TRIP_BASE,
            vehicle: { ...VEHICLE_DIESEL_FULL, consumptionLPer100kmBaseline: null },
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
    });

    expect(result.precisionMethod).toBe('por_defecto');
  });

  it('cargo_weight_kg null → cargaKg=0 sin crash', async () => {
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: null },
            trip: { ...TRIP_BASE, cargoWeightKg: null },
            vehicle: null,
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
    });

    expect(result.emisionesKgco2eWtw).toBeGreaterThan(0);
  });
});

describe('generarEcoPreview — Routes API path', () => {
  it('routesApiKey + ruta válida → dataSource=routes_api con duration + fuel', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        distanceKm: 120.5,
        durationS: 5400,
        fuelL: 25.7,
        polylineEncoded: 'abc123',
      },
    ]);
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: VEH_ID },
            trip: TRIP_BASE,
            vehicle: VEHICLE_DIESEL_FULL,
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'test-key',
    });

    expect(result.dataSource).toBe('routes_api');
    expect(result.distanceKm).toBe(120.5);
    expect(result.durationS).toBe(5400);
    expect(result.fuelLitersEstimated).toBe(25.7);
    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        emissionType: 'DIESEL',
        origin: TRIP_BASE.originAddressRaw,
        destination: TRIP_BASE.destinationAddressRaw,
      }),
    );
  });

  it('routesApiKey pero Routes API throw → fallback a tabla_chile + log warn', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota exceeded'));
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: null },
            trip: TRIP_BASE,
            vehicle: null,
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'test-key',
    });

    expect(result.dataSource).toBe('tabla_chile');
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it('Routes API devuelve [] → fallback a tabla_chile', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: null },
            trip: TRIP_BASE,
            vehicle: null,
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'test-key',
    });

    expect(result.dataSource).toBe('tabla_chile');
  });

  it('Routes API devuelve route con distanceKm=0 → fallback', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 0, durationS: 0, fuelL: null, polylineEncoded: '' },
    ]);
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: null },
            trip: TRIP_BASE,
            vehicle: null,
          },
        ],
      ],
    });

    const result = await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'test-key',
    });

    expect(result.dataSource).toBe('tabla_chile');
  });

  it('vehículo sin fuelType conocido → no manda emissionType a Routes API', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 100, durationS: 4500, fuelL: null, polylineEncoded: 'x' },
    ]);
    const db = makeDb({
      selects: [
        [
          {
            offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: VEH_ID },
            trip: TRIP_BASE,
            vehicle: { ...VEHICLE_DIESEL_FULL, fuelType: 'fuel_alien' },
          },
        ],
      ],
    });

    await generarEcoPreview({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'test-key',
    });

    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({ emissionType: undefined }),
    );
  });
});

describe('generarEcoPreview — mapFuelToEmissionType branches', () => {
  const cases = [
    ['gasolina', 'GASOLINE'],
    ['gas_glp', 'GASOLINE'],
    ['gas_gnc', 'GASOLINE'],
    ['electrico', 'ELECTRIC'],
    ['hidrogeno', 'ELECTRIC'],
    ['hibrido_diesel', 'HYBRID'],
    ['hibrido_gasolina', 'HYBRID'],
  ] as const;

  for (const [fuel, expected] of cases) {
    it(`${fuel} → ${expected}`, async () => {
      (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { distanceKm: 50, durationS: 3000, fuelL: 5, polylineEncoded: 'p' },
      ]);
      const db = makeDb({
        selects: [
          [
            {
              offer: { id: OFFER_ID, empresaId: EMPRESA_ID, suggestedVehicleId: VEH_ID },
              trip: TRIP_BASE,
              vehicle: { ...VEHICLE_DIESEL_FULL, fuelType: fuel },
            },
          ],
        ],
      });

      await generarEcoPreview({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        routesApiKey: 'test-key',
      });

      expect(computeRoutes).toHaveBeenCalledWith(
        expect.objectContaining({ emissionType: expected }),
      );
    });
  }
});
