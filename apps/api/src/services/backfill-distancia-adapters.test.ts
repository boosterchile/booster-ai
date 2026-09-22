import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./routes-api.js', () => ({ computeRoutes: vi.fn() }));
vi.mock('./posicion-segmento.js', () => ({ cargarPingsVentana: vi.fn() }));

import {
  type CandidatoBackfill,
  persistirBackfill,
  reconstruirTripBackfill,
} from './backfill-distancia-adapters.js';
import type { ReconstruccionTrip } from './backfill-distancia-real.js';
import { cargarPingsVentana } from './posicion-segmento.js';
import { computeRoutes } from './routes-api.js';

/** Mock de db.transaction(cb) con spies de tx.insert (journal) y tx.update (metricas). */
function makeTxDb() {
  const insert = vi.fn(() => ({ values: vi.fn(async () => []) }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) }));
  const tx = { insert, update };
  return {
    db: { transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) } as never,
    insert,
    update,
  };
}

const okR: ReconstruccionTrip = {
  tripId: 't1',
  coveragePctAntes: 40,
  nivelAntes: 'secundario_modeled',
  resultado: {
    ok: true,
    distanciaKmReal: 120,
    coveragePct: 80,
    nivelNuevo: 'primario_verificable',
    cambiaNivel: true,
    llamadasRoutes: 2,
  },
};
const abortR: ReconstruccionTrip = {
  tripId: 't2',
  coveragePctAntes: 0,
  nivelAntes: 'secundario_modeled',
  resultado: { ok: false, abortReason: 'routes_error', llamadasRoutes: 3 },
};

describe('persistirBackfill', () => {
  it('OK → journal INSERT + tripMetrics UPDATE (ambos en la misma transacción)', async () => {
    const { db, insert, update } = makeTxDb();
    await persistirBackfill(db, okR);
    expect(insert).toHaveBeenCalledTimes(1); // bitacora
    expect(update).toHaveBeenCalledTimes(1); // metricas_viaje
  });

  it('ABORT → SOLO journal INSERT, NUNCA UPDATE de metricas (distancia sigue null → reintentable)', async () => {
    const { db, insert, update } = makeTxDb();
    await persistirBackfill(db, abortR);
    expect(insert).toHaveBeenCalledTimes(1); // el journal captura el abort (motivo + llamadas)
    expect(update).not.toHaveBeenCalled(); // metricas_viaje INTACTO
  });

  it('ABORT → el journal registra el motivo y las llamadas a Routes', async () => {
    const { db, insert } = makeTxDb();
    await persistirBackfill(db, abortR);
    const values = (insert.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> }).values
      .mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.motivoAbort).toBe('routes_error');
    expect(values.llamadasRoutes).toBe(3);
    expect(values.coveragePctAntes).toBe('0'); // before-state guardado
    expect(values.distanceKmRealDespues).toBeNull(); // abort no tiene after
  });
});

describe('reconstruirTripBackfill — relleno de huecos con Routes', () => {
  type Mock = ReturnType<typeof vi.fn>;
  const candidato: CandidatoBackfill = {
    tripId: 't9',
    coveragePctAntes: 0,
    nivelAntes: 'secundario_modeled',
    precisionMethod: 'modelado',
    vehicleId: 'v9',
    pickupAt: new Date('2026-09-21T12:00:00Z'),
    deliveredAt: new Date('2026-09-21T13:00:00Z'),
  };
  // 1 tramo observado (gap 30 s) + 1 hueco (gap 120 s → Routes).
  const pings = [
    { tMs: 0, lat: -33.4, lng: -70.6 },
    { tMs: 30_000, lat: -33.41, lng: -70.61 },
    { tMs: 150_000, lat: -33.43, lng: -70.61 },
  ];
  const makeLogger = () => {
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
    return logger;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('HUECO → Routes recibe coordenadas, no el string «lat,lng» (400 Address Waypoint)', async () => {
    (cargarPingsVentana as Mock).mockResolvedValueOnce(pings);
    (computeRoutes as Mock).mockResolvedValue([
      { distanceKm: 5, durationS: 100, fuelL: null, polylineEncoded: '', startLocation: null },
    ]);
    const logger = makeLogger();

    const r = await reconstruirTripBackfill({
      db: {} as never,
      logger: logger as never,
      routesProjectId: 'proj',
      candidato,
    });

    expect(r.resultado.ok).toBe(true);
    const arg = (computeRoutes as Mock).mock.lastCall?.[0] as {
      origin: unknown;
      destination: unknown;
      logger: unknown;
    };
    expect(arg.origin).toEqual({ lat: -33.41, lng: -70.61 });
    expect(arg.destination).toEqual({ lat: -33.43, lng: -70.61 });
    expect(arg.logger).toBe(logger);
  });

  it('Routes falla → abortReason=routes_error y el error queda en el log (no se traga)', async () => {
    (cargarPingsVentana as Mock).mockResolvedValueOnce(pings);
    (computeRoutes as Mock).mockRejectedValue(new Error('Routes 503'));
    const logger = makeLogger();

    const r = await reconstruirTripBackfill({
      db: {} as never,
      logger: logger as never,
      routesProjectId: 'proj',
      candidato,
    });

    expect(r.resultado).toEqual({ ok: false, abortReason: 'routes_error', llamadasRoutes: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 't9', err: expect.any(Error) }),
      expect.stringContaining('Routes'),
    );
  });
});
