import type { Logger } from '@booster-ai/logger';

/**
 * Backfill de re-derivación de históricos (F0-0 paso 1).
 *
 * Es el ÚNICO paso que **reescribe datos ya existentes** (los otros escriben
 * hacia adelante). Por eso el orquestador fija cuatro garantías, con las
 * dependencias inyectadas para testearlas sin DB:
 *
 *   1. **Dry-run** — `dryRun: true` calcula y reporta, pero NO llama a `persistir`.
 *   2. **Resumabilidad** — procesa por `cargarCandidatos(desdeCursor, limite)` y
 *      devuelve `ultimoCursor`; una re-ejecución reanuda desde ahí. La correctitud
 *      real la da el filtro `distancia_km_real IS NULL` del cargador (un trip ya
 *      escrito no vuelve a ser candidato).
 *   3. **Cota agregada** — `llamadasRoutesTotal` suma las llamadas a Routes de
 *      todos los trips (visible en dry-run, antes de gastar cuota/costo).
 *   4. **Reversibilidad** — en write mode, `persistir` recibe el `before-state`
 *      (coverage_pct/nivel originales) para poder revertir. Un abort NO se
 *      persiste → la distancia sigue null → reintentable sin corromper.
 */

export type AbortReconstruccion = 'sin_observacion' | 'cap_exceeded' | 'routes_error';

/** Candidato mínimo devuelto por el cargador (paginado por cursor). */
export interface CandidatoTrip {
  tripId: string;
}

/** Reconstrucción de un trip SIN escribir. Incluye el before-state (para revert). */
export interface ReconstruccionTrip {
  tripId: string;
  /** coverage_pct ANTES del backfill (denominador viejo) — se guarda para revertir. */
  coveragePctAntes: number | null;
  /** certification_level ANTES del backfill. */
  nivelAntes: string | null;
  resultado:
    | {
        ok: true;
        distanciaKmReal: number;
        coveragePct: number;
        nivelNuevo: string;
        cambiaNivel: boolean;
        llamadasRoutes: number;
      }
    | { ok: false; abortReason: AbortReconstruccion; llamadasRoutes: number };
}

export interface BackfillReport {
  procesados: number;
  /** Trips efectivamente escritos (0 en dry-run). */
  actualizados: number;
  cambiaronNivel: number;
  abortados: Record<AbortReconstruccion, number>;
  llamadasRoutesTotal: number;
  /** tripId del último procesado — la próxima corrida reanuda desde acá. */
  ultimoCursor: string | null;
}

export async function ejecutarBackfill(opts: {
  logger: Logger;
  dryRun: boolean;
  cargarCandidatos: (desdeCursor: string | null, limite: number) => Promise<CandidatoTrip[]>;
  reconstruir: (c: CandidatoTrip) => Promise<ReconstruccionTrip>;
  /** Write mode: persiste el before-state (journal) + el UPDATE atómico. */
  persistir: (r: ReconstruccionTrip) => Promise<void>;
  desdeCursor?: string | null;
  limite?: number;
}): Promise<BackfillReport> {
  const { logger, dryRun, cargarCandidatos, reconstruir, persistir } = opts;
  const limite = opts.limite ?? 500;
  const desdeCursor = opts.desdeCursor ?? null;

  const report: BackfillReport = {
    procesados: 0,
    actualizados: 0,
    cambiaronNivel: 0,
    abortados: { sin_observacion: 0, cap_exceeded: 0, routes_error: 0 },
    llamadasRoutesTotal: 0,
    ultimoCursor: desdeCursor,
  };

  const candidatos = await cargarCandidatos(desdeCursor, limite);
  for (const c of candidatos) {
    const r = await reconstruir(c);
    report.procesados++;
    report.llamadasRoutesTotal += r.resultado.llamadasRoutes;
    report.ultimoCursor = r.tripId;

    if (r.resultado.ok) {
      if (r.resultado.cambiaNivel) {
        report.cambiaronNivel++;
      }
      if (!dryRun) {
        // Reversibilidad: `persistir` guarda el before-state (journal) ANTES de
        // sobrescribir, en la misma unidad que el UPDATE atómico.
        await persistir(r);
        report.actualizados++;
      }
    } else {
      // Abort NO se persiste → distancia sigue null → cae a estimación y es
      // reintentable en una corrida futura (idempotencia bajo re-ejecución).
      report.abortados[r.resultado.abortReason]++;
    }
  }

  logger.info(
    { ...report, dryRun },
    dryRun ? 'backfill dry-run completado' : 'backfill completado',
  );
  return report;
}
