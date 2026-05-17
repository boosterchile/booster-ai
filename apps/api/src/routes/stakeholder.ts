import type { Logger } from '@booster-ai/logger';
import { aplicarKAnonymity } from '@booster-ai/shared-schemas';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { memberships, tripMetrics, trips, users, zonasStakeholder } from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';
import {
  type ViajeAgregable,
  calcularHorarioPico,
  puntoEnBoundingBox,
} from '../services/stakeholder-aggregations.js';

/**
 * D11 — Endpoints stakeholder geo aggregations (ADR-041).
 *   GET /stakeholder/zonas — cards 30d con k-anonymity ≥ 5
 *
 * Auth: rol `stakeholder_sostenibilidad` activo (inline; UserContext no
 * surfacea memberships stakeholder vía empresa-join).
 *
 * Spec criterio 3 mapeado al schema actual (gap resolution post-abort):
 *   - state IN ('entregado')  (era 'delivered'/'confirmed_by_shipper'/...)
 *   - pickup_at == pickupWindowStart
 *   - origen_lat/origen_lng  (migration 0035 — nullable, backfill futuro)
 */
export function createStakeholderRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/zonas', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const userRow = (
      await opts.db.select().from(users).where(eq(users.firebaseUid, claims.uid)).limit(1)
    )[0];
    if (!userRow) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const member = (
      await opts.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, userRow.id),
            eq(memberships.role, 'stakeholder_sostenibilidad'),
            eq(memberships.status, 'activa'),
          ),
        )
        .limit(1)
    )[0];
    if (!member) {
      return c.json({ error: 'forbidden_stakeholder_role' }, 403);
    }

    const zonas = await opts.db
      .select()
      .from(zonasStakeholder)
      .where(eq(zonasStakeholder.isActive, true));

    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const viajesRows = await opts.db
      .select({
        pickup_at: trips.pickupWindowStart,
        origin_lat: trips.originLat,
        origin_lng: trips.originLng,
        actual: tripMetrics.carbonEmissionsKgco2eActual,
        estimated: tripMetrics.carbonEmissionsKgco2eEstimated,
      })
      .from(trips)
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .where(
        and(
          eq(trips.status, 'entregado'),
          gte(trips.pickupWindowStart, windowStart),
          isNotNull(trips.originLat),
          isNotNull(trips.originLng),
          isNotNull(trips.pickupWindowStart),
        ),
      );

    const cards = zonas.map((zona) => {
      const z = {
        lat_min: Number(zona.latMin),
        lat_max: Number(zona.latMax),
        lng_min: Number(zona.lngMin),
        lng_max: Number(zona.lngMax),
      };
      const dentro: ViajeAgregable[] = viajesRows
        .filter((r) =>
          puntoEnBoundingBox({ lat: Number(r.origin_lat), lng: Number(r.origin_lng) }, z),
        )
        .map((r) => ({
          pickup_at: r.pickup_at as Date,
          tipo_carga: 'carga_seca',
          fuel_type: 'diesel',
          carbon_emissions_kgco2e_actual: r.actual == null ? null : Number(r.actual),
          carbon_emissions_kgco2e_estimated: r.estimated == null ? null : Number(r.estimated),
        }));
      const co2e = dentro.reduce(
        (s, v) =>
          s + (v.carbon_emissions_kgco2e_actual ?? v.carbon_emissions_kgco2e_estimated ?? 0),
        0,
      );
      const pico = calcularHorarioPico(dentro);
      const raw = [
        {
          viajes_30d: dentro.length,
          co2e_total_kg: co2e,
          horario_pico_inicio: pico?.inicio ?? null,
          horario_pico_fin: pico?.fin ?? null,
        },
      ];
      const [masked] = aplicarKAnonymity(raw, 5, 'viajes_30d');
      const insufficient = dentro.length < 5;
      opts.logger.info(
        { stakeholderId: userRow.id, zonaSlug: zona.slug, viajes_30d: dentro.length },
        'GET /stakeholder/zonas zona',
      );
      return {
        id: zona.id,
        slug: zona.slug,
        nombre: zona.nombre,
        region: zona.regionCode,
        tipo: zona.tipo,
        viajes_30d: insufficient ? null : masked!.viajes_30d,
        co2e_total_kg: insufficient ? null : masked!.co2e_total_kg,
        horario_pico_inicio: insufficient ? null : masked!.horario_pico_inicio,
        horario_pico_fin: insufficient ? null : masked!.horario_pico_fin,
        insufficient_data: insufficient,
      };
    });

    return c.json({ zonas: cards });
  });

  return app;
}
