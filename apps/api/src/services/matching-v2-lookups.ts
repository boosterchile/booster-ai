import type { Logger } from '@booster-ai/logger';
import { type CarrierCandidateV2, tierBoostFromSlug } from '@booster-ai/matching-algorithm';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, carrierMemberships, offers, trips } from '../db/schema.js';

/**
 * Lookups SQL del orchestrator v2 (ADR-033).
 *
 * Para cada empresa candidata, computa los campos extra que la función
 * pura `scoreCandidateV2` necesita:
 *
 *   - `tripActivoDestinoRegionMatch`: trip activo (asignado | en_proceso)
 *     con destino en la región del origen del trip nuevo.
 *   - `tripsRecientes`: total + matchRegional últimos 7 días.
 *   - `ofertasUltimos90d`: total + aceptadas últimos 90 días.
 *   - `tierBoost`: priority boost derivado del tier de membresía activa.
 *
 * **Diseño**: una sola query batch que retorna las agregaciones por
 * `empresa_id` para todas las empresas a la vez. Evita N+1.
 *
 * **Performance target**: P95 < 200ms para sets de hasta 50 empresas.
 * Si crece, agregar índices específicos:
 *   - `idx_assignments_empresa_status` (parcial WHERE status IN ('asignado','en_proceso'))
 *   - `idx_assignments_empresa_delivered` (parcial WHERE delivered_at IS NOT NULL)
 *   - `idx_offers_empresa_created` (compuesto empresa_id + created_at)
 *
 * **Idempotente**: solo lee. Sin side effects.
 */

export interface CarrierLookupAggregate {
  empresaId: string;
  tripActivoDestinoRegionMatch: boolean;
  tripsRecientesTotalUltimos7d: number;
  tripsRecientesMatchRegionalUltimos7d: number;
  ofertasUltimos90dTotales: number;
  ofertasUltimos90dAceptadas: number;
  tierBoost: number;
}

export interface RunV2LookupsInput {
  db: Db;
  logger: Logger;
  /** Empresas candidatas (resultado del filtro de zona/transportista activo). */
  empresaIds: string[];
  /** Región del origen del trip nuevo. Usada para el match regional. */
  originRegionCode: string;
}

/**
 * Ejecuta las queries agregadas y devuelve un Map por empresaId.
 * Las empresas sin actividad reciente reciben defaults (zeros + tier 0).
 */
export async function lookupCarriersForV2(
  input: RunV2LookupsInput,
): Promise<Map<string, CarrierLookupAggregate>> {
  const { db, logger, empresaIds, originRegionCode } = input;

  if (empresaIds.length === 0) {
    return new Map();
  }

  // 1. Trips activos con destino en la región del origen del nuevo trip.
  //    Match perfecto: el carrier YA va a esa región.
  const tripsActivos = await db
    .select({
      empresaCarrierId: assignments.empresaId,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(
      and(
        inArray(assignments.empresaId, empresaIds),
        inArray(trips.status, ['asignado', 'en_proceso']),
        eq(trips.destinationRegionCode, originRegionCode),
      ),
    );
  const empresasConTripActivo = new Set(tripsActivos.map((r) => r.empresaCarrierId));

  // 2. Histórico 7d: total + matchRegional por empresa.
  //    SQL-side aggregation para evitar N queries.
  const sevenDaysAgo = sql`now() - interval '7 days'`;
  const historicRows = await db
    .select({
      empresaId: assignments.empresaId,
      totalUltimos7d: sql<number>`count(*)::int`,
      matchRegionalUltimos7d: sql<number>`sum(case when ${trips.destinationRegionCode} = ${originRegionCode} then 1 else 0 end)::int`,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(
      and(inArray(assignments.empresaId, empresaIds), gte(assignments.deliveredAt, sevenDaysAgo)),
    )
    .groupBy(assignments.empresaId);
  const historicByEmpresa = new Map(
    historicRows.map((r) => [
      r.empresaId,
      {
        total: r.totalUltimos7d ?? 0,
        match: r.matchRegionalUltimos7d ?? 0,
      },
    ]),
  );

  // 3. Reputación 90d: total ofertas + aceptadas.
  const ninetyDaysAgo = sql`now() - interval '90 days'`;
  const reputacionRows = await db
    .select({
      empresaId: offers.empresaId,
      totales: sql<number>`count(*)::int`,
      aceptadas: sql<number>`sum(case when ${offers.status} = 'aceptada' then 1 else 0 end)::int`,
    })
    .from(offers)
    .where(and(inArray(offers.empresaId, empresaIds), gte(offers.createdAt, ninetyDaysAgo)))
    .groupBy(offers.empresaId);
  const reputacionByEmpresa = new Map(
    reputacionRows.map((r) => [
      r.empresaId,
      {
        totales: r.totales ?? 0,
        aceptadas: r.aceptadas ?? 0,
      },
    ]),
  );

  // 4. Tier activo por empresa.
  const tierRows = await db
    .select({
      empresaId: carrierMemberships.empresaId,
      tierSlug: carrierMemberships.tierSlug,
    })
    .from(carrierMemberships)
    .where(
      and(
        inArray(carrierMemberships.empresaId, empresaIds),
        eq(carrierMemberships.status, 'activa'),
      ),
    );
  const tierByEmpresa = new Map(tierRows.map((r) => [r.empresaId, r.tierSlug]));

  // 5. Agregar todo en el Map final.
  const result = new Map<string, CarrierLookupAggregate>();
  for (const empresaId of empresaIds) {
    const historic = historicByEmpresa.get(empresaId);
    const reputacion = reputacionByEmpresa.get(empresaId);
    const tierSlug = tierByEmpresa.get(empresaId);
    result.set(empresaId, {
      empresaId,
      tripActivoDestinoRegionMatch: empresasConTripActivo.has(empresaId),
      tripsRecientesTotalUltimos7d: historic?.total ?? 0,
      tripsRecientesMatchRegionalUltimos7d: historic?.match ?? 0,
      ofertasUltimos90dTotales: reputacion?.totales ?? 0,
      ofertasUltimos90dAceptadas: reputacion?.aceptadas ?? 0,
      tierBoost: tierBoostFromSlug(tierSlug),
    });
  }

  logger.debug(
    {
      empresasEvaluadas: empresaIds.length,
      conTripActivo: empresasConTripActivo.size,
      conHistorico: historicByEmpresa.size,
      conReputacion: reputacionByEmpresa.size,
      conTier: tierByEmpresa.size,
    },
    'matching v2 lookups completados',
  );

  // Touch `lt` para suppress unused linter (importado por si se requiere
  // en futuras queries con rangos temporales más complejos).
  void lt;

  return result;
}

/**
 * Combina los datos del vehículo + lookups SQL en un `CarrierCandidateV2`
 * listo para `scoreCandidateV2`. Helper de conveniencia para el orchestrator.
 */
export function buildCandidateV2(opts: {
  empresaId: string;
  vehicleId: string;
  vehicleCapacityKg: number;
  lookup: CarrierLookupAggregate;
}): CarrierCandidateV2 {
  const { empresaId, vehicleId, vehicleCapacityKg, lookup } = opts;
  return {
    empresaId,
    vehicleId,
    vehicleCapacityKg,
    tripActivoDestinoRegionMatch: lookup.tripActivoDestinoRegionMatch,
    tripsRecientes: {
      totalUltimos7d: lookup.tripsRecientesTotalUltimos7d,
      matchRegionalUltimos7d: lookup.tripsRecientesMatchRegionalUltimos7d,
    },
    ofertasUltimos90d: {
      totales: lookup.ofertasUltimos90dTotales,
      aceptadas: lookup.ofertasUltimos90dAceptadas,
    },
    tierBoost: lookup.tierBoost,
  };
}
