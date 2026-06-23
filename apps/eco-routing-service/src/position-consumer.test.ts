/**
 * TDD — position-consumer
 *
 * Cobertura:
 * - Mensaje válido → valida con driverPositionEventSchema, actualiza el store
 * - Payload inválido → Zod rechaza + log, NO crashea (consumer sigue corriendo)
 * - Mensaje sin viajeId (campo requerido) → rechazado gracefully
 * - Primera posición de un viaje → dispara baseline ETA (computeRoutes)
 * - computeRoutes falla → log + skip (no crash)
 * - Debounce: solo una evaluación por viajeId en la ventana de debounce
 */

import type { Logger } from '@booster-ai/logger';
import type { Message } from '@google-cloud/pubsub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPositionConsumer } from './position-consumer.js';
import { createInMemoryTripStateStore } from './trip-state-store.js';

// Mock @google-cloud/pubsub — no necesitamos un cliente real en unit tests
vi.mock('@google-cloud/pubsub', () => ({
  PubSub: vi.fn(),
}));

// Mock del computeRoutes del routes-api-client
vi.mock('@booster-ai/routes-api-client', () => ({
  computeRoutes: vi.fn(),
  RoutesApiError: class RoutesApiError extends Error {
    code: string;
    httpStatus: number | null;
    constructor(message: string, code: string, httpStatus: number | null) {
      super(message);
      this.name = 'RoutesApiError';
      this.code = code;
      this.httpStatus = httpStatus;
    }
  },
}));

// Mock readTripData — por defecto retorna un trip en_proceso (happy path)
vi.mock('./trip-data-reader.js', () => ({
  readTripData: vi.fn().mockResolvedValue({
    destinoAddressRaw: 'Av. Providencia 1234, Santiago',
    ecoRoutePolylineEncoded: null,
    estado: 'en_proceso',
    fuelType: 'diesel',
  }),
}));

// Mock evaluarReruteo — no necesitamos probar su lógica interna aquí
vi.mock('./evaluar-reruteo.js', () => ({
  evaluarReruteo: vi.fn().mockResolvedValue(null),
}));

// Importar DESPUÉS del mock para que Vitest lo intercepte
import { computeRoutes } from '@booster-ai/routes-api-client';
import type { RouteSuggestion } from '@booster-ai/routes-api-client';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Construye un Message mock de Pub/Sub */
function buildMessage(data: unknown, overrides?: Partial<Message>): Message {
  return {
    id: 'msg-test-1',
    ackId: 'ack-1',
    attributes: {},
    deliveryAttempt: 0,
    data: Buffer.from(JSON.stringify(data), 'utf-8'),
    publishTime: new Date(),
    received: Date.now(),
    ack: vi.fn(),
    nack: vi.fn(),
    modAckDeadline: vi.fn(),
    ...overrides,
  } as unknown as Message;
}

/** Retorna las funciones mock sin el cast a Logger */
function buildMockLoggerRaw() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  };
}

/** Logger mock minimal — cast as Logger para satisfacer el tipo sin instanciar pino */
function buildMockLogger() {
  return buildMockLoggerRaw() as unknown as Logger;
}

const VALID_VIAJE_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_VEHICULO_ID = '550e8400-e29b-41d4-a716-446655440001';

const validPayload = {
  viajeId: VALID_VIAJE_ID,
  vehiculoId: VALID_VEHICULO_ID,
  lat: -33.4569,
  lng: -70.6483,
  registradoEn: '2026-06-23T10:00:00Z',
};

describe('createPositionConsumer', () => {
  const mockComputeRoutes = vi.mocked(computeRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mensaje valido', () => {
    it('llama a store.setPosicion y hace ack', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();
      const setPosicionSpy = vi.spyOn(store, 'setPosicion');

      // computeRoutes retorna una ruta baseline
      mockComputeRoutes.mockResolvedValueOnce([
        {
          distanceKm: 10,
          durationS: 1200,
          fuelL: 1.5,
          polylineEncoded: 'abc123',
        } satisfies RouteSuggestion,
      ]);

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0, // sin debounce en tests
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      const msg = buildMessage(validPayload);
      await consumer.handleMessage(msg);

      expect(setPosicionSpy).toHaveBeenCalledWith(
        VALID_VIAJE_ID,
        expect.objectContaining({ lat: -33.4569, lng: -70.6483 }),
      );
      expect(msg.ack).toHaveBeenCalledOnce();
      expect(msg.nack).not.toHaveBeenCalled();
    });

    it('persiste el baseline ETA en la primera posicion del viaje', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();
      const setBaselineSpy = vi.spyOn(store, 'setBaseline');

      mockComputeRoutes.mockResolvedValueOnce([
        {
          distanceKm: 10,
          durationS: 3600,
          fuelL: 1.5,
          polylineEncoded: 'poly123',
        } satisfies RouteSuggestion,
      ]);

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      const msg = buildMessage(validPayload);
      await consumer.handleMessage(msg);

      // Baseline debe haberse llamado con durationS=3600
      expect(setBaselineSpy).toHaveBeenCalledWith(VALID_VIAJE_ID, 3600);
    });

    it('NO llama a computeRoutes en la segunda posicion del mismo viaje (baseline ya existe)', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();

      mockComputeRoutes.mockResolvedValue([
        {
          distanceKm: 10,
          durationS: 3600,
          fuelL: null,
          polylineEncoded: 'poly',
        } satisfies RouteSuggestion,
      ]);

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      // Primera posición
      await consumer.handleMessage(buildMessage(validPayload));
      // Segunda posición (mismo viaje)
      await consumer.handleMessage(buildMessage({ ...validPayload, lat: -33.5 }));

      // computeRoutes solo se llama UNA vez (baseline en la primera posición)
      expect(mockComputeRoutes).toHaveBeenCalledTimes(1);
    });
  });

  describe('payload invalido', () => {
    it('payload que no parsea JSON → ack + log.error, no crashea', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();
      const setPosicionSpy = vi.spyOn(store, 'setPosicion');

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      const msg: Message = {
        id: 'msg-bad',
        ackId: 'ack-bad',
        attributes: {},
        deliveryAttempt: 0,
        data: Buffer.from('{ invalid json', 'utf-8'),
        publishTime: new Date(),
        received: Date.now(),
        ack: vi.fn(),
        nack: vi.fn(),
        modAckDeadline: vi.fn(),
      } as unknown as Message;

      await consumer.handleMessage(msg);

      expect(logger.error).toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledOnce(); // ack para descartar (no reintentar JSON invalido)
      expect(setPosicionSpy).not.toHaveBeenCalled();
    });

    it('payload JSON valido pero sin campos requeridos → Zod rechaza, ack + log.error, no crashea', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();
      const setPosicionSpy = vi.spyOn(store, 'setPosicion');

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      // Payload sin viajeId y con lat inválida
      const badPayload = { lat: 999, lng: -70.6 };
      const msg = buildMessage(badPayload);

      await consumer.handleMessage(msg);

      expect(logger.error).toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledOnce();
      expect(setPosicionSpy).not.toHaveBeenCalled();
      expect(msg.nack).not.toHaveBeenCalled(); // no hace nack en validación
    });

    it('lat fuera de rango [-90,90] → Zod rechaza, consumer no crashea', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      const msg = buildMessage({ ...validPayload, lat: 200 }); // lat inválida
      await consumer.handleMessage(msg);

      expect(logger.error).toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledOnce();
    });
  });

  describe('computeRoutes falla (best-effort)', () => {
    it('si computeRoutes lanza excepcion → log + skip, ack igual, no crashea', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();
      const setBaselineSpy = vi.spyOn(store, 'setBaseline');

      mockComputeRoutes.mockRejectedValueOnce(new Error('Routes API timeout'));

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      const msg = buildMessage(validPayload);
      await consumer.handleMessage(msg);

      // El consumer NO crashea y hace ack
      expect(msg.ack).toHaveBeenCalledOnce();
      expect(msg.nack).not.toHaveBeenCalled();
      // No se llamó setBaseline (best-effort: si falla routes, no hay baseline)
      expect(setBaselineSpy).not.toHaveBeenCalled();
      // Sí se llamó log.error o log.warn — accedemos vía vi.mocked para el tipo
      const loggerMock = logger as unknown as ReturnType<typeof buildMockLoggerRaw>;
      const errorOrWarnCalled =
        loggerMock.error.mock.calls.length > 0 || loggerMock.warn.mock.calls.length > 0;
      expect(errorOrWarnCalled).toBe(true);
    });

    it('si computeRoutes retorna array vacio → log + skip baseline, ack igual', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();
      const setBaselineSpy = vi.spyOn(store, 'setBaseline');

      mockComputeRoutes.mockResolvedValueOnce([]);

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'driver-positions',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      const msg = buildMessage(validPayload);
      await consumer.handleMessage(msg);

      expect(msg.ack).toHaveBeenCalledOnce();
      // Sin rutas → no se puede establecer baseline
      expect(setBaselineSpy).not.toHaveBeenCalled();
    });
  });

  describe('source telemetry-events', () => {
    it('acepta mensajes con formato driverPositionEvent del pipeline Teltonika', async () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      const logger = buildMockLogger();
      const setPosicionSpy = vi.spyOn(store, 'setPosicion');

      mockComputeRoutes.mockResolvedValueOnce([
        {
          distanceKm: 5,
          durationS: 600,
          fuelL: 0.8,
          polylineEncoded: 'xyz',
        } satisfies RouteSuggestion,
      ]);

      const consumer = createPositionConsumer({
        store,
        logger,
        projectId: 'test-project',
        source: 'telemetry-events',
        evaluationDebounceMs: 0,
        db: {} as unknown as NodePgDatabase<Record<string, unknown>>,
        cooldownSegundos: 300,
      });

      const msg = buildMessage(validPayload);
      await consumer.handleMessage(msg);

      expect(setPosicionSpy).toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledOnce();
    });
  });
});
