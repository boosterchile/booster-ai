import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  assignments,
  memberships,
  tripMetrics,
  trips,
  users,
  vehicles,
  zonasStakeholder,
} from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';
import {
  type ViajeAgregable,
  agregarPorCombustible,
  agregarPorHoraDelDia,
  agregarPorTipoCarga,
  aplicarKAnonymityHorario,
  aplicarKAnonymityQuasiId,
  calcularHorarioPico,
} from '../services/stakeholder-aggregations.js';

/**
 * GET /me/stakeholder/zonas/:slug/agregaciones — agregaciones geográficas
 * k-anonimizadas para el rol `stakeholder_sostenibilidad` (gap B2 / D11).
 *
 * Cablea el servicio puro `stakeholder-aggregations.ts` (que estaba dormido)
 * a un endpoint HTTP. Privacy-critical (Ley 19.628): garantiza por
 * construcción server-side la no-identificabilidad de empresas individuales.
 *
 * Contrato (ADR-041 + ADR-042):
 *  - Filtro por comuna: viajes con `originComunaCode` ∈ `zona.comunaCodes`
 *    (ADR-042 §1/§2). Zona sin comunas → 0 viajes → insufficient_data.
 *  - Ventana fija 30 días sobre `pickupWindowStart` (ADR-041 §3).
 *  - Estado terminal `entregado` únicamente (ADR-042 §5): no borradores,
 *    no cancelados, no estados intermedios.
 *  - k-anonymity a 3 niveles (ADR-042 §6):
 *      1. dataset-level: total < 5 → `insufficient_data: true` SIN buckets.
 *      2. por_hora_del_dia: 24 buckets cerrados, sub-k enmascarado (hora se
 *         preserva).
 *      3. por_tipo_carga / por_combustible: quasi-identifier, sub-k se DROPEA.
 *
 * RBAC: el usuario debe tener una membership ACTIVA con rol
 * `stakeholder_sostenibilidad` (espejo de la surface web
 * `apps/web/src/routes/stakeholder-zonas.tsx`). Sin eso → 403.
 *
 * NOTA DE CONSENT-SCOPE (TODO explícito — ver §"Consent" abajo): el modelo
 * de consent ESG (`checkStakeholderConsent`, ADR-028) NO expresa "qué
 * stakeholder puede ver qué zona". Sus scopes (`generador_carga`,
 * `transportista`, `organizacion`, `portafolio_viajes`) apuntan a `empresas.id`
 * vía UUID; una zona agrega viajes cross-empresa identificados por `slug`, no
 * por UUID de una empresa. Implementar un check de consent inventando esa
 * semántica sería peor que no tenerlo (un gate mal hecho da falsa confianza).
 * Por eso este endpoint enforce el check de ROL + el gate de privacidad
 * (k-anon, lo crítico) y deja el consent-scope marcado como TODO. Ver reporte.
 */
export function createStakeholderZonasRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  const VENTANA_DIAS = 30;
  const ESTADO_TERMINAL = 'entregado' as const;
  const ROL_STAKEHOLDER = 'stakeholder_sostenibilidad' as const;
  const ESTADO_MEMBERSHIP_ACTIVA = 'activa' as const;
  /** Sentinel para vehículos sin combustible declarado (`vehicles.fuelType` es
   *  nullable). NO se asume 'diesel' — inventar el combustible falsearía la
   *  agregación ESG (ADR-042 rechazó el hardcode de 'diesel' en el T8 v1). */
  const FUEL_DESCONOCIDO = 'desconocido';

  const paramsSchema = z.object({
    slug: z
      .string()
      .min(1)
      .max(60)
      // El slug es URL-safe por contrato del schema (zonas_stakeholder.slug).
      .regex(/^[a-z0-9-]+$/, 'slug inválido'),
  });

  app.get('/zonas/:slug/agregaciones', zValidator('param', paramsSchema), async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me/stakeholder/zonas hit sin firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    // 1. Resolver user.id desde el Firebase claim.
    const userRows = await opts.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const userId = userRows[0]?.id;
    if (!userId) {
      return c.json({ error: 'user_not_registered', code: 'user_not_registered' }, 404);
    }

    // 2. RBAC: el user debe tener una membership ACTIVA con rol
    //    stakeholder_sostenibilidad (en una organización stakeholder, ADR-034).
    //    Sin esto, no es un stakeholder y no puede ver agregaciones de zona.
    //    NOTA: esto valida el ROL, no el consent-scope (ver TODO arriba).
    const stakeholderMembership = await opts.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.role, ROL_STAKEHOLDER),
          eq(memberships.status, ESTADO_MEMBERSHIP_ACTIVA),
        ),
      )
      .limit(1);
    if (stakeholderMembership.length === 0) {
      opts.logger.warn({ userId }, 'acceso a agregaciones stakeholder sin rol stakeholder activo');
      return c.json({ error: 'forbidden_not_stakeholder', code: 'forbidden_not_stakeholder' }, 403);
    }

    const { slug } = c.req.valid('param');

    // 3. Zona por slug (activa). El drill-down solo opera sobre zonas curadas.
    const zonaRows = await opts.db
      .select({
        id: zonasStakeholder.id,
        slug: zonasStakeholder.slug,
        nombre: zonasStakeholder.nombre,
        comunaCodes: zonasStakeholder.comunaCodes,
      })
      .from(zonasStakeholder)
      .where(and(eq(zonasStakeholder.slug, slug), eq(zonasStakeholder.isActive, true)))
      .limit(1);
    const zona = zonaRows[0];
    if (!zona) {
      return c.json({ error: 'zona_not_found', code: 'zona_not_found' }, 404);
    }

    // 4. Viajes que matchean: comuna ∈ zona.comunaCodes + ventana 30d +
    //    estado 'entregado'. Join a asignaciones→vehículos para fuel_type y a
    //    metricas_viaje para CO2e. `inArray([])` → SQL `false` (zona sin
    //    comunas no agrega nada, per ADR-042 §2 comment).
    const desdeFecha = new Date(Date.now() - VENTANA_DIAS * 24 * 60 * 60 * 1000);

    const viajeRows = await opts.db
      .select({
        pickupWindowStart: trips.pickupWindowStart,
        tipoCarga: trips.cargoType,
        fuelType: vehicles.fuelType,
        carbonEmissionsKgco2eActual: tripMetrics.carbonEmissionsKgco2eActual,
        carbonEmissionsKgco2eEstimated: tripMetrics.carbonEmissionsKgco2eEstimated,
      })
      .from(trips)
      .innerJoin(assignments, eq(assignments.tripId, trips.id))
      .leftJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .where(
        and(
          inArray(trips.originComunaCode, zona.comunaCodes),
          eq(trips.status, ESTADO_TERMINAL),
          gte(trips.pickupWindowStart, desdeFecha),
        ),
      );

    // Construir ViajeAgregable[] (forma que el servicio puro consume).
    // - pickupWindowStart es nullable en BD; el filtro `gte` ya descarta NULL
    //   (NULL no satisface el predicado), pero TS no lo infiere → guard +
    //   skip defensivo.
    // - CO2e: numeric llega como string|null desde pg → parse a number|null.
    // - fuelType nullable → sentinel 'desconocido' (NO 'diesel').
    const viajes: ViajeAgregable[] = [];
    for (const r of viajeRows) {
      if (!r.pickupWindowStart) {
        continue;
      }
      viajes.push({
        pickupWindowStart: r.pickupWindowStart,
        carbonEmissionsKgco2eActual: parseNumericOrNull(r.carbonEmissionsKgco2eActual),
        carbonEmissionsKgco2eEstimated: parseNumericOrNull(r.carbonEmissionsKgco2eEstimated),
        tipoCarga: r.tipoCarga,
        fuelType: r.fuelType ?? FUEL_DESCONOCIDO,
      });
    }

    // 5. Gate dataset-level (ADR-042 §6 nivel 1): si el total de viajes que
    //    matchean < K_ANON (5), NO bucketizar. Devolver shell con
    //    insufficient_data — evita el bucket-existence leak.
    const totalViajes = viajes.length;
    const K_ANON = 5;

    // Audit/observabilidad del acceso ESG. Ver §"Consent" / TODO arriba: el
    // audit log estructurado de `recordStakeholderAccess` requiere
    // (stakeholderId, consentId) que el modelo de consent NO provee para
    // zonas. Mientras eso se define, dejamos traza estructurada del acceso.
    // TODO(consent-scope): cuando Producto defina el modelo de consent para
    // zonas stakeholder, invocar recordStakeholderAccess (audit bloqueante,
    // ADR-028) con el consentId resuelto en vez de este log informativo.
    opts.logger.info(
      {
        userId,
        actorFirebaseUid: claims.uid,
        zonaSlug: zona.slug,
        zonaId: zona.id,
        totalViajes,
        insufficientData: totalViajes < K_ANON,
        httpPath: c.req.path,
      },
      'acceso stakeholder a agregaciones de zona',
    );

    if (totalViajes < K_ANON) {
      return c.json({
        slug: zona.slug,
        nombre: zona.nombre,
        ventana_dias: VENTANA_DIAS,
        insufficient_data: true,
      });
    }

    // 6. Agregar + aplicar k-anonymity por bucket (vía el servicio existente).
    const porTipoCarga = aplicarKAnonymityQuasiId(agregarPorTipoCarga(viajes, opts.logger));
    const porCombustible = aplicarKAnonymityQuasiId(agregarPorCombustible(viajes, opts.logger));
    const porHoraDelDia = aplicarKAnonymityHorario(agregarPorHoraDelDia(viajes, opts.logger));
    const horarioPico = calcularHorarioPico(viajes);

    return c.json({
      slug: zona.slug,
      nombre: zona.nombre,
      ventana_dias: VENTANA_DIAS,
      insufficient_data: false,
      total_viajes: totalViajes,
      por_tipo_carga: porTipoCarga,
      por_combustible: porCombustible,
      por_hora_del_dia: porHoraDelDia,
      horario_pico: horarioPico,
    });
  });

  return app;
}

/**
 * Parsea un `numeric` de pg (string | null) a number | null. Devuelve null si
 * el valor es null o no es un número finito (fail-safe: un CO2e corrupto no
 * debe contaminar la suma — `resolveCo2e` lo omite del total).
 */
function parseNumericOrNull(v: string | null): number | null {
  if (v == null) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
