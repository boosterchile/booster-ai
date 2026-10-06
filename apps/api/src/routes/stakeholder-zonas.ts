import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { type SQL, and, arrayContains, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  assignments,
  consents,
  memberships,
  organizacionesStakeholder,
  stakeholders,
  tripMetrics,
  trips,
  users,
  vehicles,
  zonasStakeholder,
} from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';
import { recordStakeholderAccess } from '../services/consent.js';
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
 * Autorización (spec aislamiento-hallazgos-tenant):
 *  - Rol activo `stakeholder_sostenibilidad` en una organización no eliminada.
 *  - Perfil en `stakeholders` y al menos un consent vigente de
 *    `emisiones_carbono` con alcance `generador_carga` o `transportista`.
 *    Esos `empresas.id` son el único conjunto de viajes que entra al agregado.
 *  - `region_ambito` de la organización (ADR-034), si está puesto, tiene que
 *    coincidir con `zonas_stakeholder.region_code`. NULL = ámbito nacional.
 *  - `sector_ambito` puesto → 403. No hay columna de sector en viajes ni en
 *    empresas, y servir el agregado igual ignoraría el ámbito.
 *  - Audit bloqueante: un insert en `log_acceso_stakeholder` por cada consent
 *    usado, antes de responder. Si falla, 500.
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

    // 2. Rol activo en una organización stakeholder que sigue viva.
    const stakeholderMembership = await opts.db
      .select({
        id: memberships.id,
        orgId: organizacionesStakeholder.id,
        regionAmbito: organizacionesStakeholder.regionAmbito,
        sectorAmbito: organizacionesStakeholder.sectorAmbito,
      })
      .from(memberships)
      .innerJoin(
        organizacionesStakeholder,
        eq(memberships.organizacionStakeholderId, organizacionesStakeholder.id),
      )
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.role, ROL_STAKEHOLDER),
          eq(memberships.status, ESTADO_MEMBERSHIP_ACTIVA),
          isNull(organizacionesStakeholder.deletedAt),
        ),
      )
      .limit(1);
    const membresia = stakeholderMembership[0];
    if (!membresia) {
      opts.logger.warn({ userId }, 'acceso a agregaciones stakeholder sin rol stakeholder activo');
      return c.json({ error: 'forbidden_not_stakeholder', code: 'forbidden_not_stakeholder' }, 403);
    }

    // 3. Perfil ESG. Sin fila en `stakeholders` no hay a quién colgar un consent.
    const perfilRows = await opts.db
      .select({ id: stakeholders.id })
      .from(stakeholders)
      .where(eq(stakeholders.userId, userId))
      .limit(1);
    const perfil = perfilRows[0];
    if (!perfil) {
      opts.logger.warn({ userId }, 'agregaciones stakeholder sin perfil de stakeholder');
      return c.json({ error: 'forbidden', code: 'consent_required' }, 403);
    }

    // 4. Consents vigentes de emisiones, acotados a empresas (generador o
    //    transportista). No se inventa un alcance de zona.
    const ahora = new Date();
    const consentRows = await opts.db
      .select({
        id: consents.id,
        scopeType: consents.scopeType,
        scopeId: consents.scopeId,
      })
      .from(consents)
      .where(
        and(
          eq(consents.stakeholderId, perfil.id),
          isNull(consents.revokedAt),
          or(isNull(consents.expiresAt), sql`${consents.expiresAt} > ${ahora}`),
          inArray(consents.scopeType, ['generador_carga', 'transportista']),
          arrayContains(consents.dataCategories, ['emisiones_carbono']),
        ),
      )
      .limit(200);
    if (consentRows.length === 0) {
      opts.logger.warn(
        { userId, stakeholderId: perfil.id },
        'agregaciones stakeholder sin consent de emisiones',
      );
      return c.json({ error: 'forbidden', code: 'consent_required' }, 403);
    }

    const { slug } = c.req.valid('param');

    // 5. Zona por slug (activa), con su región para el ámbito de ADR-034.
    const zonaRows = await opts.db
      .select({
        id: zonasStakeholder.id,
        slug: zonasStakeholder.slug,
        nombre: zonasStakeholder.nombre,
        regionCode: zonasStakeholder.regionCode,
        comunaCodes: zonasStakeholder.comunaCodes,
      })
      // rls-allowlist: catálogo curado de zonas (ADR-041), sin empresaId; el alcance lo ponen el rol, la región y los consents.
      .from(zonasStakeholder)
      .where(and(eq(zonasStakeholder.slug, slug), eq(zonasStakeholder.isActive, true)))
      .limit(1);
    const zona = zonaRows[0];
    if (!zona) {
      return c.json({ error: 'zona_not_found', code: 'zona_not_found' }, 404);
    }

    const regionAmbito = membresia.regionAmbito?.trim() ?? '';
    if (regionAmbito.length > 0 && regionAmbito !== zona.regionCode) {
      opts.logger.warn(
        { userId, orgId: membresia.orgId, regionAmbito, regionZona: zona.regionCode },
        'agregaciones stakeholder fuera del ámbito regional',
      );
      return c.json({ error: 'forbidden', code: 'fuera_de_ambito' }, 403);
    }
    const sectorAmbito = membresia.sectorAmbito?.trim() ?? '';
    if (sectorAmbito.length > 0) {
      opts.logger.warn(
        { userId, orgId: membresia.orgId },
        'agregaciones stakeholder con ámbito sectorial que el modelo no puede filtrar',
      );
      return c.json({ error: 'forbidden', code: 'ambito_sectorial_no_disponible' }, 403);
    }

    const idsGenerador = consentRows
      .filter((row) => row.scopeType === 'generador_carga')
      .map((row) => row.scopeId);
    const idsTransportista = consentRows
      .filter((row) => row.scopeType === 'transportista')
      .map((row) => row.scopeId);
    const filtroEmpresa = filtroPorEmpresasConsentidas(idsGenerador, idsTransportista);
    if (!filtroEmpresa) {
      return c.json({ error: 'forbidden', code: 'consent_required' }, 403);
    }

    // 6. Viajes de esas empresas: comuna ∈ zona + ventana 30d + entregado.
    //    `inArray([])` no se arma: un lado vacío se omite.
    const desdeFecha = new Date(Date.now() - VENTANA_DIAS * 24 * 60 * 60 * 1000);

    const viajeRows = await opts.db
      .select({
        pickupWindowStart: trips.pickupWindowStart,
        tipoCarga: trips.cargoType,
        fuelType: vehicles.fuelType,
        carbonEmissionsKgco2eActual: tripMetrics.carbonEmissionsKgco2eActual,
        carbonEmissionsKgco2eEstimated: tripMetrics.carbonEmissionsKgco2eEstimated,
      })
      // rls-allowlist: agrega solo empresas con consent de emisiones_carbono (generadorCargaEmpresaId o assignments.empresaId); k-anon ≥ 5 sigue siendo el gate de privacidad.
      .from(trips)
      .innerJoin(assignments, eq(assignments.tripId, trips.id))
      .leftJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .where(
        and(
          inArray(trips.originComunaCode, zona.comunaCodes),
          eq(trips.status, ESTADO_TERMINAL),
          gte(trips.pickupWindowStart, desdeFecha),
          filtroEmpresa,
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

    const payload =
      totalViajes < K_ANON
        ? {
            slug: zona.slug,
            nombre: zona.nombre,
            ventana_dias: VENTANA_DIAS,
            insufficient_data: true as const,
          }
        : {
            slug: zona.slug,
            nombre: zona.nombre,
            ventana_dias: VENTANA_DIAS,
            insufficient_data: false as const,
            total_viajes: totalViajes,
            por_tipo_carga: aplicarKAnonymityQuasiId(agregarPorTipoCarga(viajes, opts.logger)),
            por_combustible: aplicarKAnonymityQuasiId(agregarPorCombustible(viajes, opts.logger)),
            por_hora_del_dia: aplicarKAnonymityHorario(agregarPorHoraDelDia(viajes, opts.logger)),
            horario_pico: calcularHorarioPico(viajes),
          };

    const bytesServed = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    try {
      for (const consent of consentRows) {
        if (consent.scopeType !== 'generador_carga' && consent.scopeType !== 'transportista') {
          continue;
        }
        await recordStakeholderAccess({
          db: opts.db,
          logger: opts.logger,
          stakeholderId: perfil.id,
          consentId: consent.id,
          scopeType: consent.scopeType,
          scopeId: consent.scopeId,
          dataCategory: 'emisiones_carbono',
          httpPath: c.req.path,
          actorFirebaseUid: claims.uid,
          bytesServed,
        });
      }
    } catch (err) {
      opts.logger.error(
        { err, userId, stakeholderId: perfil.id, zonaId: zona.id },
        'audit de agregación stakeholder falló',
      );
      return c.json({ error: 'internal_server_error' }, 500);
    }

    opts.logger.info(
      {
        userId,
        stakeholderId: perfil.id,
        zonaId: zona.id,
        totalViajes,
        insufficientData: payload.insufficient_data,
        consents: consentRows.length,
      },
      'acceso stakeholder a agregaciones de zona',
    );

    return c.json(payload);
  });

  return app;
}

/**
 * Predicado de empresas consentidas. Un arreglo vacío no se pasa a
 * `inArray`: en SQL eso no es "ninguna fila", y no queremos depender de esa
 * lectura.
 */
function filtroPorEmpresasConsentidas(
  idsGenerador: string[],
  idsTransportista: string[],
): SQL | undefined {
  if (idsGenerador.length > 0 && idsTransportista.length > 0) {
    return or(
      inArray(trips.generadorCargaEmpresaId, idsGenerador),
      inArray(assignments.empresaId, idsTransportista),
    );
  }
  if (idsGenerador.length > 0) {
    return inArray(trips.generadorCargaEmpresaId, idsGenerador);
  }
  if (idsTransportista.length > 0) {
    return inArray(assignments.empresaId, idsTransportista);
  }
  return undefined;
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
