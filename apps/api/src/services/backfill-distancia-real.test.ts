import { describe, expect, it, vi } from 'vitest';
// RED: `ejecutarBackfill` aún no existe. Es el backfill de re-derivación de
// históricos (F0-0 paso 1) — el ÚNICO paso que reescribe datos ya existentes.
// Cuatro invariantes: dry-run, resumabilidad, cota agregada de Routes, reversibilidad.
import { type ReconstruccionTrip, ejecutarBackfill } from './backfill-distancia-real.js';

const noopLogger = {
  trace: () => undefined,
  debug: () => undefined,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: () => undefined,
  child() {
    return this;
  },
} as never;

// Reconstrucción de un trip SIN escribir (el resultado que reconstruir() devuelve).
const ok = (
  tripId: string,
  coveragePctAntes: number | null,
  nivelAntes: string | null,
  nivelNuevo: string,
  llamadasRoutes = 1,
): ReconstruccionTrip => ({
  tripId,
  coveragePctAntes,
  nivelAntes,
  resultado: {
    ok: true,
    distanciaKmReal: 100,
    coveragePct: 80,
    nivelNuevo,
    cambiaNivel: nivelAntes !== nivelNuevo,
    llamadasRoutes,
  },
});
const abortar = (
  tripId: string,
  abortReason: 'sin_observacion' | 'cap_exceeded' | 'routes_error',
  llamadasRoutes = 0,
): ReconstruccionTrip => ({
  tripId,
  coveragePctAntes: 0,
  nivelAntes: 'secundario_modeled',
  resultado: { ok: false, abortReason, llamadasRoutes },
});

describe('ejecutarBackfill — re-derivación de históricos (F0-0 paso 1)', () => {
  it('DRY-RUN — NO persiste; reporta cuántos cambian de nivel, cuántos abortan y por qué', async () => {
    const persistir = vi.fn();
    const report = await ejecutarBackfill({
      logger: noopLogger,
      dryRun: true,
      cargarCandidatos: async () => [{ tripId: 't1' }, { tripId: 't2' }, { tripId: 't3' }],
      reconstruir: vi
        .fn()
        .mockResolvedValueOnce(ok('t1', 42, 'secundario_modeled', 'primario_verificable', 3))
        .mockResolvedValueOnce(abortar('t2', 'routes_error', 2))
        .mockResolvedValueOnce(abortar('t3', 'sin_observacion', 1)),
      persistir,
    });

    expect(persistir).not.toHaveBeenCalled(); // dry-run no escribe NADA
    expect(report.procesados).toBe(3);
    expect(report.cambiaronNivel).toBe(1);
    expect(report.abortados.routes_error).toBe(1);
    expect(report.abortados.sin_observacion).toBe(1);
    expect(report.abortados.cap_exceeded).toBe(0);
  });

  it('COTA AGREGADA — reporta el total de llamadas a Routes (medible antes de correr)', async () => {
    const report = await ejecutarBackfill({
      logger: noopLogger,
      dryRun: true,
      cargarCandidatos: async () => [{ tripId: 't1' }, { tripId: 't2' }, { tripId: 't3' }],
      reconstruir: vi
        .fn()
        .mockResolvedValueOnce(ok('t1', 0, 'secundario_modeled', 'secundario_modeled', 3))
        .mockResolvedValueOnce(abortar('t2', 'routes_error', 2))
        .mockResolvedValueOnce(abortar('t3', 'sin_observacion', 1)),
      persistir: vi.fn(),
    });
    expect(report.llamadasRoutesTotal).toBe(6); // 3 + 2 + 1 — costo/cuota visible en dry-run
  });

  it('REVERSIBILIDAD — en write mode persiste el before-state (coverage_pct original) para revert', async () => {
    const persistir = vi.fn();
    await ejecutarBackfill({
      logger: noopLogger,
      dryRun: false,
      cargarCandidatos: async () => [{ tripId: 't1' }],
      reconstruir: vi
        .fn()
        .mockResolvedValueOnce(ok('t1', 42, 'secundario_modeled', 'primario_verificable')),
      persistir,
    });
    expect(persistir).toHaveBeenCalledTimes(1);
    const r = persistir.mock.calls[0]?.[0] as ReconstruccionTrip;
    // el coverage_pct viejo (denominador viejo) se guarda ANTES de sobrescribir →
    // hay camino de vuelta.
    expect(r.coveragePctAntes).toBe(42);
    expect(r.nivelAntes).toBe('secundario_modeled');
  });

  it('IDEMPOTENCIA — un abort NO se persiste (distancia sigue null → re-run lo reintenta sin corromper)', async () => {
    const persistir = vi.fn();
    const report = await ejecutarBackfill({
      logger: noopLogger,
      dryRun: false,
      cargarCandidatos: async () => [{ tripId: 't1' }],
      reconstruir: vi.fn().mockResolvedValueOnce(abortar('t1', 'routes_error', 1)),
      persistir,
    });
    expect(persistir).not.toHaveBeenCalled(); // no escribe → sigue null → reintentable
    expect(report.actualizados).toBe(0);
    expect(report.abortados.routes_error).toBe(1);
  });

  it('RESUMABILIDAD — pagina por cursor: 2ª página arranca desde el último tripId', async () => {
    // Página 1 (llena) → sigue; página 2 vacía → termina. El cursor avanza t0→t2.
    const cargarCandidatos = vi
      .fn()
      .mockResolvedValueOnce([{ tripId: 't1' }, { tripId: 't2' }])
      .mockResolvedValueOnce([]);
    const report = await ejecutarBackfill({
      logger: noopLogger,
      dryRun: true,
      limite: 2,
      desdeCursor: 't0',
      cargarCandidatos,
      reconstruir: vi
        .fn()
        .mockResolvedValueOnce(ok('t1', 0, 'secundario_modeled', 'secundario_modeled'))
        .mockResolvedValueOnce(ok('t2', 0, 'secundario_modeled', 'secundario_modeled')),
      persistir: vi.fn(),
    });
    expect(cargarCandidatos).toHaveBeenNthCalledWith(1, 't0', 2); // arranca en el cursor dado
    expect(cargarCandidatos).toHaveBeenNthCalledWith(2, 't2', 2); // 2ª página desde el último
    expect(report.ultimoCursor).toBe('t2');
  });

  it('CORRECTITUD — procesa EXACTAMENTE N aunque escriba mientras itera (keyset, no offset)', async () => {
    // El bug clásico: paginar sobre `IS NULL` mientras escribes `distancia_km_real`.
    // Con offset saltaría trips; con keyset (tripId > cursor) procesa los N.
    const N = 7;
    const K = 3;
    const todos = Array.from({ length: N }, (_, i) => `t${String(i).padStart(2, '0')}`);
    const escritos = new Set<string>();
    // Cargador realista: filtra los ya escritos (IS NULL) + keyset (id > cursor).
    const cargarCandidatos = async (cursor: string | null, limite: number) =>
      todos
        .filter((id) => !escritos.has(id) && (cursor === null || id > cursor))
        .sort()
        .slice(0, limite)
        .map((tripId) => ({ tripId }));
    const persistir = async (r: ReconstruccionTrip) => {
      escritos.add(r.tripId); // simula que el trip deja de ser candidato
    };
    const report = await ejecutarBackfill({
      logger: noopLogger,
      dryRun: false,
      limite: K,
      cargarCandidatos,
      reconstruir: async (c) => ok(c.tripId, 0, 'secundario_modeled', 'primario_verificable'),
      persistir,
    });
    expect(report.procesados).toBe(N); // ni uno menos
    expect(report.actualizados).toBe(N);
    expect(escritos.size).toBe(N);
  });
});
