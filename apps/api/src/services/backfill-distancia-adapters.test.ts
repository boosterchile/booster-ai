import { describe, expect, it, vi } from 'vitest';
import { persistirBackfill } from './backfill-distancia-adapters.js';
import type { ReconstruccionTrip } from './backfill-distancia-real.js';

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
