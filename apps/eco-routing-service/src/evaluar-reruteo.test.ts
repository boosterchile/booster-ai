import { beforeEach, describe, expect, it, vi } from 'vitest';

// All vi.mock calls must be at the top (Vitest hoisting)
vi.mock('@booster-ai/routes-api-client', () => ({
  computeRoutes: vi.fn(),
}));

vi.mock('@booster-ai/traffic-condition-detector', () => ({
  detectarDegradacion: vi.fn(),
}));

vi.mock('@booster-ai/route-alternatives-evaluator', () => ({
  evaluarAlternativas: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn().mockReturnValue({
      startActiveSpan: vi
        .fn()
        .mockImplementation((_name: string, fn: (span: unknown) => unknown) => {
          const mockSpan = { setAttribute: vi.fn(), end: vi.fn() };
          return fn(mockSpan);
        }),
    }),
  },
}));

import { evaluarAlternativas } from '@booster-ai/route-alternatives-evaluator';
import { computeRoutes } from '@booster-ai/routes-api-client';
import { detectarDegradacion } from '@booster-ai/traffic-condition-detector';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { evaluarReruteo } from './evaluar-reruteo.js';
import type { TripData } from './trip-data-reader.js';
import type { TripStateStore } from './trip-state-store.js';

// Typed mock helpers
const mockComputeRoutes = vi.mocked(computeRoutes);
const mockDetectarDegradacion = vi.mocked(detectarDegradacion);
const mockEvaluarAlternativas = vi.mocked(evaluarAlternativas);

// ── Shared fixtures ──────────────────────────────────────────────────────────

function buildMockStore(overrides: Partial<TripStateStore> = {}): TripStateStore {
  return {
    getEstado: vi.fn(),
    setPosicion: vi.fn(),
    setBaseline: vi.fn(),
    registrarSugerencia: vi.fn(),
    puedeSugerir: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as TripStateStore;
}

const baseTripData: TripData = {
  destinoAddressRaw: 'Av. Providencia 1234, Santiago',
  ecoRoutePolylineEncoded: null,
  estado: 'en_proceso',
  fuelType: 'diesel',
};

const baseEstado = {
  posicionActual: { lat: -33.43, lng: -70.65, registradoEn: '2026-06-22T10:00:00.000Z' },
  etaBaselineSegundos: 1200,
  ultimaSugerenciaEn: null,
  actualizadoEn: new Date(),
};

const baseRoutes = [
  { durationS: 2000, distanceKm: 10, fuelL: 1.5, polylineEncoded: 'poly1' },
  { durationS: 1500, distanceKm: 8, fuelL: 1.2, polylineEncoded: 'poly2' },
];

function buildLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Parameters<typeof evaluarReruteo>[1]['logger'];
}

function buildDb() {
  return {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as NodePgDatabase<Record<string, unknown>>;
}

function buildOpts(
  overrides: Partial<Parameters<typeof evaluarReruteo>[1]> = {},
): Parameters<typeof evaluarReruteo>[1] {
  return {
    store: buildMockStore(),
    db: buildDb(),
    projectId: 'test-project',
    cooldownSegundos: 300,
    logger: buildLogger(),
    tripData: baseTripData,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('evaluarReruteo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('degradado + recomendada → persiste INSERT + returns RouteSuggestion + registrarSugerencia called', async () => {
    const store = buildMockStore({
      puedeSugerir: vi.fn().mockReturnValue(true),
      getEstado: vi.fn().mockReturnValue(baseEstado),
    });
    const db = buildDb();
    const logger = buildLogger();

    mockComputeRoutes.mockResolvedValue(baseRoutes);
    mockDetectarDegradacion.mockReturnValue({ degradado: true, severidadPct: 0.66 });
    mockEvaluarAlternativas.mockReturnValue({
      tipo: 'recomendada',
      polyline: 'poly2',
      deltaEtaSegundos: -500,
      deltaCo2eKg: -0.3,
    });

    const result = await evaluarReruteo('viaje-001', buildOpts({ store, db, logger }));

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      polylineAlternativa: 'poly2',
      deltaEtaSegundos: -500,
      deltaCo2eKg: -0.3,
      etaBaselineSegundos: 1200,
      posicionLat: -33.43,
      posicionLng: -70.65,
    });
    expect(store.registrarSugerencia).toHaveBeenCalledWith('viaje-001');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('computeRoutes throws → returns null, no crash', async () => {
    const store = buildMockStore({
      puedeSugerir: vi.fn().mockReturnValue(true),
      getEstado: vi.fn().mockReturnValue(baseEstado),
    });
    const logger = buildLogger();

    mockComputeRoutes.mockRejectedValue(new Error('Routes API timeout'));

    const result = await evaluarReruteo('viaje-002', buildOpts({ store, logger }));

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('cooldown active (puedeSugerir=false) → returns null immediately, no computeRoutes', async () => {
    const store = buildMockStore({
      puedeSugerir: vi.fn().mockReturnValue(false),
    });

    const result = await evaluarReruteo('viaje-003', buildOpts({ store }));

    expect(result).toBeNull();
    expect(mockComputeRoutes).not.toHaveBeenCalled();
  });

  it('ninguna_mejor → returns null, no INSERT', async () => {
    const store = buildMockStore({
      puedeSugerir: vi.fn().mockReturnValue(true),
      getEstado: vi.fn().mockReturnValue(baseEstado),
    });
    const db = buildDb();

    mockComputeRoutes.mockResolvedValue(baseRoutes);
    mockDetectarDegradacion.mockReturnValue({ degradado: true, severidadPct: 0.3 });
    mockEvaluarAlternativas.mockReturnValue({ tipo: 'ninguna_mejor' });

    const result = await evaluarReruteo('viaje-004', buildOpts({ store, db }));

    expect(result).toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('detectarDegradacion returns degradado=false → returns null', async () => {
    const store = buildMockStore({
      puedeSugerir: vi.fn().mockReturnValue(true),
      getEstado: vi.fn().mockReturnValue(baseEstado),
    });

    mockComputeRoutes.mockResolvedValue(baseRoutes);
    mockDetectarDegradacion.mockReturnValue({ degradado: false });

    const result = await evaluarReruteo('viaje-005', buildOpts({ store }));

    expect(result).toBeNull();
    expect(mockEvaluarAlternativas).not.toHaveBeenCalled();
  });

  it('etaBaselineSegundos <= 0 (poisoned) → returns null, computeRoutes NOT called, logger.warn called', async () => {
    const poisonedEstado = {
      ...baseEstado,
      etaBaselineSegundos: 0,
    };
    const store = buildMockStore({
      puedeSugerir: vi.fn().mockReturnValue(true),
      getEstado: vi.fn().mockReturnValue(poisonedEstado),
    });
    const logger = buildLogger();

    const result = await evaluarReruteo('viaje-006', buildOpts({ store, logger }));

    expect(result).toBeNull();
    expect(mockComputeRoutes).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
