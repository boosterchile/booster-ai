import {
  calcularFactorIncertidumbre,
  derivarNivelCertificacion,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  assignments,
  bitacoraBackfillDistancia,
  tripMetrics,
  trips,
  vehicles,
} from '../db/schema.js';
import type { NivelCert, ReconstruccionTrip } from './backfill-distancia-real.js';
import { cargarPingsVentana } from './calcular-cobertura-telemetria.js';
import { type EstimarHuecoKm, computarEscrituraDistanciaReal } from './calcular-distancia-real.js';
import { computeRoutes } from './routes-api.js';

/**
 * **Predicado ÚNICO de candidato del backfill** (F0-0 paso 1): trip entregado,
 * con Teltonika, y sin `distancia_km_real` todavía.
 *
 * `contarCandidatosBackfill` y `cargarCandidatosBackfill` se construyen AMBOS
 * sobre esto (mismo predicado + mismos joins). El guard de `trips_esperados`
 * compara el conteo contra el conjunto que se escribe: si los dos queries
 * divergieran, el 409 validaría otro universo y dejaría de proteger.
 */
export function condicionCandidatoBackfill() {
  return and(
    isNotNull(assignments.deliveredAt),
    isNotNull(vehicles.teltonikaImei),
    isNull(tripMetrics.distanceKmActual),
  );
}

export interface CandidatoBackfill {
  tripId: string;
  coveragePctAntes: number | null;
  nivelAntes: NivelCert | null;
  precisionMethod: 'exacto_canbus' | 'modelado' | 'por_defecto' | null;
  vehicleId: string;
  pickupAt: Date;
  deliveredAt: Date;
}

/** Conteo de candidatos — MISMO predicado + joins que `cargar`. */
export async function contarCandidatosBackfill(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tripMetrics)
    .innerJoin(assignments, eq(assignments.tripId, tripMetrics.tripId))
    .innerJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
    .innerJoin(trips, eq(trips.id, tripMetrics.tripId))
    .where(condicionCandidatoBackfill());
  return rows[0]?.n ?? 0;
}

/** Página de candidatos por KEYSET (tripId > cursor) — MISMO predicado que `contar`. */
export async function cargarCandidatosBackfill(
  db: Db,
  cursor: string | null,
  limite: number,
): Promise<CandidatoBackfill[]> {
  const where =
    cursor === null
      ? condicionCandidatoBackfill()
      : and(condicionCandidatoBackfill(), gt(tripMetrics.tripId, cursor));

  const rows = await db
    .select({
      tripId: tripMetrics.tripId,
      coveragePct: tripMetrics.coveragePct,
      certificationLevel: tripMetrics.certificationLevel,
      precisionMethod: tripMetrics.precisionMethod,
      vehicleId: assignments.vehicleId,
      deliveredAt: assignments.deliveredAt,
      pickupWindowStart: trips.pickupWindowStart,
      createdAt: trips.createdAt,
    })
    .from(tripMetrics)
    .innerJoin(assignments, eq(assignments.tripId, tripMetrics.tripId))
    .innerJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
    .innerJoin(trips, eq(trips.id, tripMetrics.tripId))
    .where(where)
    .orderBy(asc(tripMetrics.tripId))
    .limit(limite);

  const candidatos: CandidatoBackfill[] = [];
  for (const r of rows) {
    // El predicado garantiza vehicleId + deliveredAt no-null; defensivo igual.
    if (r.vehicleId === null || r.deliveredAt === null) {
      continue;
    }
    candidatos.push({
      tripId: r.tripId,
      coveragePctAntes: r.coveragePct !== null ? Number(r.coveragePct) : null,
      nivelAntes: (r.certificationLevel as NivelCert | null) ?? null,
      precisionMethod: r.precisionMethod as CandidatoBackfill['precisionMethod'],
      vehicleId: r.vehicleId,
      pickupAt: r.pickupWindowStart ?? r.createdAt,
      deliveredAt: r.deliveredAt,
    });
  }
  return candidatos;
}

/**
 * Reconstruye un trip SIN escribir (dry-run fiel: llama a Routes de verdad para
 * medir costo y detectar routes_error). Devuelve la `ReconstruccionTrip` con el
 * before-state y el resultado (ok / abort + motivo + nº llamadas).
 */
export async function reconstruirTripBackfill(opts: {
  db: Db;
  logger: Logger;
  routesProjectId?: string | undefined;
  candidato: CandidatoBackfill;
}): Promise<ReconstruccionTrip> {
  const { db, routesProjectId, candidato } = opts;
  const before = {
    tripId: candidato.tripId,
    coveragePctAntes: candidato.coveragePctAntes,
    nivelAntes: candidato.nivelAntes,
  };

  const pings = await cargarPingsVentana({
    db,
    vehicleId: candidato.vehicleId,
    pickupAt: candidato.pickupAt,
    deliveredAt: candidato.deliveredAt,
  });

  let llamadasRoutes = 0;
  const estimarHuecoKm: EstimarHuecoKm = async (desde, hasta) => {
    llamadasRoutes++;
    const rutas = await computeRoutes({
      projectId: routesProjectId ?? '',
      origin: `${desde.lat},${desde.lng}`,
      destination: `${hasta.lat},${hasta.lng}`,
    });
    const mejor = rutas[0];
    if (!mejor || mejor.distanceKm <= 0) {
      throw new Error('Routes: sin ruta para el hueco');
    }
    return mejor.distanceKm;
  };

  let escritura: Awaited<ReturnType<typeof computarEscrituraDistanciaReal>>;
  try {
    escritura = await computarEscrituraDistanciaReal(pings, estimarHuecoKm);
  } catch {
    return { ...before, resultado: { ok: false, abortReason: 'routes_error', llamadasRoutes } };
  }
  if (escritura === null) {
    return { ...before, resultado: { ok: false, abortReason: 'cap_exceeded', llamadasRoutes } };
  }
  if (escritura.distanciaKmReal === null) {
    return { ...before, resultado: { ok: false, abortReason: 'sin_observacion', llamadasRoutes } };
  }

  const precisionMethod = candidato.precisionMethod ?? 'por_defecto';
  const nivelNuevo = derivarNivelCertificacion({
    precisionMethod,
    routeDataSource: 'teltonika_gps',
    coveragePct: escritura.coveragePct,
  });
  return {
    ...before,
    resultado: {
      ok: true,
      distanciaKmReal: escritura.distanciaKmReal,
      coveragePct: escritura.coveragePct,
      nivelNuevo,
      cambiaNivel: candidato.nivelAntes !== nivelNuevo,
      llamadasRoutes,
    },
  };
}

/**
 * Persiste UN trip procesado, en una transacción:
 *   - SIEMPRE: fila en `bitacora_backfill_distancia` (before + after + motivo +
 *     llamadas) → reversibilidad + diagnóstico.
 *   - SOLO si `ok`: UPDATE atómico de `metricas_viaje` (distancia real + coverage
 *     §5-ext + nivel + uncertainty). Un abort NO toca `metricas_viaje` →
 *     `distancia_km_real` sigue null → reintentable.
 */
export async function persistirBackfill(db: Db, r: ReconstruccionTrip): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(bitacoraBackfillDistancia).values({
      tripId: r.tripId,
      coveragePctAntes: r.coveragePctAntes !== null ? String(r.coveragePctAntes) : null,
      certificationLevelAntes: r.nivelAntes,
      distanceKmRealAntes: null,
      coveragePctDespues: r.resultado.ok ? String(r.resultado.coveragePct) : null,
      certificationLevelDespues: r.resultado.ok ? r.resultado.nivelNuevo : null,
      distanceKmRealDespues: r.resultado.ok ? String(r.resultado.distanciaKmReal) : null,
      motivoAbort: r.resultado.ok ? null : r.resultado.abortReason,
      llamadasRoutes: r.resultado.llamadasRoutes,
    });

    if (r.resultado.ok) {
      const uncertaintyFactor = calcularFactorIncertidumbre({
        nivelCertificacion: r.resultado.nivelNuevo,
        coveragePct: r.resultado.coveragePct,
        vehicleTypeMatchesRoutesApi: true,
      });
      await tx
        .update(tripMetrics)
        .set({
          distanceKmActual: String(r.resultado.distanciaKmReal),
          routeDataSource: 'teltonika_gps',
          coveragePct: String(r.resultado.coveragePct),
          certificationLevel: r.resultado.nivelNuevo,
          uncertaintyFactor: String(uncertaintyFactor),
          updatedAt: sql`now()`,
        })
        .where(eq(tripMetrics.tripId, r.tripId));
    }
  });
}
