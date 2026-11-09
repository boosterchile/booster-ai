import type { Logger } from '@booster-ai/logger';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';

/**
 * Task 4 (plan medicion-huella-segmento): geocodificar el origen del viaje
 * vía Routes API y persistirlo en trips.origin_latitude/longitude. Contrato
 * bajo test: devuelve `{ lat, lng }` cuando persiste; devuelve `null` y emite
 * la métrica data-quality (con motivo) en TODA degradación; JAMÁS lanza —
 * la creación del viaje no depende de esto.
 */
vi.mock('./routes-api.js', () => ({
  RoutesApiError: class RoutesApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly httpStatus: number | null,
    ) {
      super(message);
      this.name = 'RoutesApiError';
    }
  },
  computeRoutes: vi.fn(),
}));

const counterAdd = vi.fn();
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: () => ({ add: counterAdd }),
}));

const { RoutesApiError, computeRoutes } = await import('./routes-api.js');
const { geocodificarOrigen } = await import('./geocodificar-origen.js');

const TRIP_ID = '00000000-0000-4000-8000-00000000c0de';
const ORIGIN = 'Av. Apoquindo 5550, Las Condes';
const DESTINATION = 'Concepción centro';

function makeLogger() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function makeDb(opts: { updateRejects?: Error } = {}) {
  const whereFn = opts.updateRejects
    ? vi.fn().mockRejectedValue(opts.updateRejects)
    : vi.fn().mockResolvedValue(undefined);
  const setFn = vi.fn(() => ({ where: whereFn }));
  const updateFn = vi.fn(() => ({ set: setFn }));
  return { db: { update: updateFn } as unknown as Db, updateFn, setFn };
}

/** UPDATE condicionado: `.where(...).returning(...)` devuelve `filas`. */
function makeDbCondicionado(filas: { id: string }[]) {
  const returningFn = vi.fn().mockResolvedValue(filas);
  const whereFn = vi.fn((_predicado: SQL) => ({ returning: returningFn }));
  const setFn = vi.fn(() => ({ where: whereFn }));
  const updateFn = vi.fn(() => ({ set: setFn }));
  return { db: { update: updateFn } as unknown as Db, whereFn, setFn, returningFn };
}

function route(startLocation: { lat: number; lng: number } | null) {
  return {
    distanceKm: 512.3,
    durationS: 21_600,
    fuelL: null,
    polylineEncoded: 'poly',
    startLocation,
    endLocation: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('geocodificarOrigen', () => {
  it('sin routesProjectId → null sin llamar Routes API ni la DB; métrica degradado/sin_project_id', async () => {
    const { db, updateFn } = makeDb();

    const result = await geocodificarOrigen({
      db,
      logger: makeLogger(),
      tripId: TRIP_ID,
      originAddress: ORIGIN,
      destinationAddress: DESTINATION,
    });

    expect(result).toBeNull();
    expect(computeRoutes).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
    expect(counterAdd).toHaveBeenCalledWith(1, {
      resultado: 'degradado',
      motivo: 'sin_project_id',
    });
  });

  it('happy path: toma legs[0].startLocation, persiste numeric(10,7) en el trip y devuelve { lat, lng }', async () => {
    vi.mocked(computeRoutes).mockResolvedValueOnce([route({ lat: -33.4188917, lng: -70.6045211 })]);
    const { db, updateFn, setFn } = makeDb();

    const result = await geocodificarOrigen({
      db,
      logger: makeLogger(),
      tripId: TRIP_ID,
      originAddress: ORIGIN,
      destinationAddress: DESTINATION,
      routesProjectId: 'booster-ai-494222',
    });

    expect(result).toEqual({ lat: -33.4188917, lng: -70.6045211 });
    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'booster-ai-494222',
        origin: ORIGIN,
        destination: DESTINATION,
        computeAlternatives: false,
      }),
    );
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({ originLatitude: '-33.4188917', originLongitude: '-70.6045211' }),
    );
    expect(counterAdd).toHaveBeenCalledWith(1, { resultado: 'ok' });
  });

  it('Routes API timeout → null, sin UPDATE, no lanza; métrica degradado/timeout', async () => {
    vi.mocked(computeRoutes).mockRejectedValueOnce(
      new RoutesApiError('Routes API timed out after 10000ms', 'timeout', null),
    );
    const { db, updateFn } = makeDb();
    const logger = makeLogger();

    await expect(
      geocodificarOrigen({
        db,
        logger,
        tripId: TRIP_ID,
        originAddress: ORIGIN,
        destinationAddress: DESTINATION,
        routesProjectId: 'p',
      }),
    ).resolves.toBeNull();

    expect(updateFn).not.toHaveBeenCalled();
    expect(counterAdd).toHaveBeenCalledWith(1, { resultado: 'degradado', motivo: 'timeout' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('Routes API sin rutas ([]) → null; métrica degradado/ruta_vacia', async () => {
    vi.mocked(computeRoutes).mockResolvedValueOnce([]);
    const { db, updateFn } = makeDb();

    const result = await geocodificarOrigen({
      db,
      logger: makeLogger(),
      tripId: TRIP_ID,
      originAddress: ORIGIN,
      destinationAddress: DESTINATION,
      routesProjectId: 'p',
    });

    expect(result).toBeNull();
    expect(updateFn).not.toHaveBeenCalled();
    expect(counterAdd).toHaveBeenCalledWith(1, { resultado: 'degradado', motivo: 'ruta_vacia' });
  });

  it('ruta sin startLocation → null; métrica degradado/sin_start_location', async () => {
    vi.mocked(computeRoutes).mockResolvedValueOnce([route(null)]);
    const { db, updateFn } = makeDb();

    const result = await geocodificarOrigen({
      db,
      logger: makeLogger(),
      tripId: TRIP_ID,
      originAddress: ORIGIN,
      destinationAddress: DESTINATION,
      routesProjectId: 'p',
    });

    expect(result).toBeNull();
    expect(updateFn).not.toHaveBeenCalled();
    expect(counterAdd).toHaveBeenCalledWith(1, {
      resultado: 'degradado',
      motivo: 'sin_start_location',
    });
  });

  it('startLocation en null island (0,0) → null, no persiste basura; métrica degradado/coordenadas_invalidas', async () => {
    vi.mocked(computeRoutes).mockResolvedValueOnce([route({ lat: 0, lng: 0 })]);
    const { db, updateFn } = makeDb();

    const result = await geocodificarOrigen({
      db,
      logger: makeLogger(),
      tripId: TRIP_ID,
      originAddress: ORIGIN,
      destinationAddress: DESTINATION,
      routesProjectId: 'p',
    });

    expect(result).toBeNull();
    expect(updateFn).not.toHaveBeenCalled();
    expect(counterAdd).toHaveBeenCalledWith(1, {
      resultado: 'degradado',
      motivo: 'coordenadas_invalidas',
    });
  });

  it('error inesperado (falla el UPDATE) → null, logger.error con el err, no lanza; métrica degradado/error_inesperado', async () => {
    vi.mocked(computeRoutes).mockResolvedValueOnce([route({ lat: -33.4, lng: -70.6 })]);
    const boom = new Error('connection terminated');
    const { db } = makeDb({ updateRejects: boom });
    const logger = makeLogger();

    await expect(
      geocodificarOrigen({
        db,
        logger,
        tripId: TRIP_ID,
        originAddress: ORIGIN,
        destinationAddress: DESTINATION,
        routesProjectId: 'p',
      }),
    ).resolves.toBeNull();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, tripId: TRIP_ID }),
      expect.any(String),
    );
    expect(counterAdd).toHaveBeenCalledWith(1, {
      resultado: 'degradado',
      motivo: 'error_inesperado',
    });
  });

  describe('soloSiOrigenVigente (editar-anular-cargas §6.1)', () => {
    it('condiciona el UPDATE a la dirección geocodificada y origin_latitude en NULL; persiste si la fila sigue igual', async () => {
      vi.mocked(computeRoutes).mockResolvedValueOnce([
        route({ lat: -33.4188917, lng: -70.6045211 }),
      ]);
      const { db, whereFn, setFn } = makeDbCondicionado([{ id: TRIP_ID }]);

      const result = await geocodificarOrigen({
        db,
        logger: makeLogger(),
        tripId: TRIP_ID,
        originAddress: ORIGIN,
        destinationAddress: DESTINATION,
        routesProjectId: 'booster-ai-494222',
        soloSiOrigenVigente: true,
      });

      expect(result).toEqual({ lat: -33.4188917, lng: -70.6045211 });
      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ originLatitude: '-33.4188917', originLongitude: '-70.6045211' }),
      );
      const predicado = whereFn.mock.calls[0]?.[0];
      if (!predicado) {
        throw new Error('el UPDATE no recibió WHERE');
      }
      const { sql, params } = new PgDialect().sqlToQuery(predicado);
      expect(sql).toContain('"origen_direccion_raw" = $');
      expect(sql).toContain('"origin_latitude" is null');
      expect(params).toEqual(expect.arrayContaining([TRIP_ID, ORIGIN]));
      expect(counterAdd).toHaveBeenCalledWith(1, { resultado: 'ok' });
    });

    it('respuesta atrasada: el origen cambió (0 filas) → null, no persiste, log y métrica origen_cambio', async () => {
      vi.mocked(computeRoutes).mockResolvedValueOnce([
        route({ lat: -33.4188917, lng: -70.6045211 }),
      ]);
      const { db } = makeDbCondicionado([]);
      const logger = makeLogger();

      const result = await geocodificarOrigen({
        db,
        logger,
        tripId: TRIP_ID,
        originAddress: ORIGIN,
        destinationAddress: DESTINATION,
        routesProjectId: 'booster-ai-494222',
        soloSiOrigenVigente: true,
      });

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP_ID, motivo: 'origen_cambio' }),
        expect.any(String),
      );
      expect(counterAdd).toHaveBeenCalledWith(1, {
        resultado: 'degradado',
        motivo: 'origen_cambio',
      });
    });

    it('sin la opción, el UPDATE sigue siendo solo por id', async () => {
      vi.mocked(computeRoutes).mockResolvedValueOnce([
        route({ lat: -33.4188917, lng: -70.6045211 }),
      ]);
      const whereFn = vi.fn((_p: SQL) => Promise.resolve(undefined));
      const db = {
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: whereFn })) })),
      } as unknown as Db;

      await geocodificarOrigen({
        db,
        logger: makeLogger(),
        tripId: TRIP_ID,
        originAddress: ORIGIN,
        destinationAddress: DESTINATION,
        routesProjectId: 'booster-ai-494222',
      });

      const predicado = whereFn.mock.calls[0]?.[0];
      if (!predicado) {
        throw new Error('el UPDATE no recibió WHERE');
      }
      const { sql } = new PgDialect().sqlToQuery(predicado);
      expect(sql).not.toContain('origen_direccion_raw');
    });
  });
});
