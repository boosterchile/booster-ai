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
 *   4. **Reversibilidad + diagnóstico** — en write mode, `persistir` recibe cada
 *      trip (ok Y abort): guarda el `before-state` (para revertir) y el
 *      `abortReason` (qué no se reconstruyó y por qué). El UPDATE de `tripMetrics`
 *      lo hace SOLO si es `ok` → un abort deja `distancia_km_real` en null →
 *      reintentable sin corromper. Dry-run no escribe NADA (ni journal).
 */

export type AbortReconstruccion = 'sin_observacion' | 'cap_exceeded' | 'routes_error';

/** Nivel de certificación (espejo del enum de metricas_viaje / carbon-calculator). */
export type NivelCert = 'primario_verificable' | 'secundario_modeled' | 'secundario_default';

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
  nivelAntes: NivelCert | null;
  resultado:
    | {
        ok: true;
        distanciaKmReal: number;
        coveragePct: number;
        nivelNuevo: NivelCert;
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

export async function ejecutarBackfill<C extends CandidatoTrip>(opts: {
  logger: Logger;
  dryRun: boolean;
  cargarCandidatos: (desdeCursor: string | null, limite: number) => Promise<C[]>;
  reconstruir: (c: C) => Promise<ReconstruccionTrip>;
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

  // Paginación por KEYSET (cursor = tripId, orden asc), NO por offset. El backfill
  // escribe `distancia_km_real` mientras itera → los trips escritos salen del
  // filtro `IS NULL`. Con keyset, esos trips quedan DETRÁS del cursor y no
  // desplazan el scan hacia adelante → se procesa EXACTAMENTE N, ni uno menos.
  // (Con offset, cada write correría el offset y saltaría trips.)
  let cursor = desdeCursor;
  for (;;) {
    const candidatos = await cargarCandidatos(cursor, limite);
    if (candidatos.length === 0) {
      break;
    }
    for (const c of candidatos) {
      const r = await reconstruir(c);
      report.procesados++;
      report.llamadasRoutesTotal += r.resultado.llamadasRoutes;
      cursor = r.tripId;
      report.ultimoCursor = cursor;

      if (r.resultado.ok) {
        if (r.resultado.cambiaNivel) {
          report.cambiaronNivel++;
        }
      } else {
        report.abortados[r.resultado.abortReason]++;
      }

      // Write mode: `persistir` se llama para TODO trip → el journal captura
      // también los aborts (motivo + llamadas), no solo los escritos. Dentro,
      // `persistir` hace el UPDATE de metricas SOLO si es `ok`: un abort deja
      // `distancia_km_real` en null → reintentable (idempotencia). Dry-run no
      // escribe NADA (ni journal).
      if (!dryRun) {
        await persistir(r);
        if (r.resultado.ok) {
          report.actualizados++;
        }
      }
    }
    // Página incompleta → no hay más candidatos.
    if (candidatos.length < limite) {
      break;
    }
  }

  logger.info(
    { ...report, dryRun },
    dryRun ? 'backfill dry-run completado' : 'backfill completado',
  );
  return report;
}
