import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { consents, memberships, users } from '../db/schema.js';
import { extractClientIp } from '../middleware/client-ip.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';
import {
  type DataCategory,
  type ScopeType,
  grantConsent,
  listConsentsGrantedBy,
  revokeConsent,
} from '../services/consent.js';

/**
 * Endpoints de consentimientos ESG (ADR-028 §"Acciones derivadas §7").
 *
 * El otorgante (un dueño/admin de la empresa dueña del recurso) emite
 * grants explícitos a stakeholders externos (auditores, mandantes
 * corporativos, reguladores). Cualquier lectura ESG por un stakeholder
 * se valida contra estos grants vía `checkStakeholderConsent`.
 *
 * Endpoints:
 *   POST   /me/consents             — otorgar nuevo grant
 *   PATCH  /me/consents/:id/revoke  — revocar grant otorgado por mí
 *   GET    /me/consents             — listar grants que yo otorgué
 */

const grantBodySchema = z.object({
  stakeholder_id: z.string().uuid(),
  scope_type: z.enum(['generador_carga', 'transportista', 'portafolio_viajes', 'organizacion']),
  scope_id: z.string().uuid(),
  data_categories: z
    .array(
      z.enum([
        'emisiones_carbono',
        'rutas',
        'distancias',
        'combustibles',
        'certificados',
        'perfiles_vehiculos',
      ]),
    )
    .min(1, 'al menos 1 categoría requerida'),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  consent_document_url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), {
      message: 'URL debe ser HTTPS',
    }),
  // Versión del aviso de privacidad que el otorgante vio al consentir
  // (evidencia Ley 21.719). Opcional mientras el flujo de captura F1b no
  // exponga una versión al otorgante; se ata al doc versionado en
  // docs/legal/ (slug, ej. 'esg-v1').
  notice_version: z.string().min(1).max(20).optional(),
});

export function createMeConsentsRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  /**
   * Resolver helper: del Firebase claim, obtiene el user.id en BD.
   * Centraliza la query para no repetir el SELECT en cada handler.
   */
  async function resolveUserId(claims: FirebaseClaims): Promise<string | null> {
    const rows = await opts.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * Validar que el otorgante tiene autoridad sobre el scope concreto del
   * grant (cierra IDOR P0-B/P1-B, auditoría 2026-06-14; ADR-028 §"Riesgos").
   *
   * - Scopes de empresa (`organizacion` / `generador_carga` / `transportista`):
   *   el `scope_id` apunta a `empresas.id`. El otorgante debe tener una
   *   membership `dueno`/`admin` ACTIVA en ESA empresa específica
   *   (`empresaId === scopeId`). No basta ser dueño/admin de *otra* empresa
   *   (P1-B).
   * - `portafolio_viajes`: deny real SIEMPRE (decisión PO O-1b, 2026-06-17).
   *   No existe tabla de portafolio, ni FK, ni call sites; no se infiere
   *   autoridad sobre una feature inexistente (P0-B).
   */
  async function userCanGrantOnScope(opts2: {
    userId: string;
    scopeType: ScopeType;
    scopeId: string;
  }): Promise<boolean> {
    if (opts2.scopeType === 'portafolio_viajes') {
      // O-1b (decisión PO 2026-06-17): el modelo de portafolio NO está
      // construido (sin tabla, sin FK, sin call sites). No se infiere
      // autoridad sobre una feature inexistente → se deniega TODO grant de
      // este scope hasta que Producto defina el modelo.
      // TODO(O-1b): al crear la tabla de portafolio (lista explícita de
      // viajes), validar que TODAS las empresas dueñas de los viajes estén
      // entre las memberships dueno/admin activas del otorgante
      // (join viajes→memberships).
      // Ref: .specs/consent-idor-y-modelo-19628-21719/spec.md §7.1 P0-B.
      return false;
    }

    // Scopes que apuntan a una empresa (organizacion / generador_carga /
    // transportista): el user debe ser dueño/admin ACTIVO de la empresa
    // específica del scope. `empresaId` es nullable (memberships de
    // stakeholder tienen empresaId=NULL); NULL nunca matchea un UUID, lo que
    // excluye correctamente las memberships de organización stakeholder.
    const rows = await opts.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, opts2.userId),
          eq(memberships.empresaId, opts2.scopeId),
          eq(memberships.status, 'activa'),
          inArray(memberships.role, ['dueno', 'admin']),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  // POST /me/consents
  app.post('/', zValidator('json', grantBodySchema), async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me/consents POST sin firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userId = await resolveUserId(claims);
    if (!userId) {
      return c.json({ error: 'user_not_registered', code: 'user_not_registered' }, 404);
    }

    const body = c.req.valid('json');

    const canGrant = await userCanGrantOnScope({
      userId,
      scopeType: body.scope_type,
      scopeId: body.scope_id,
    });
    if (!canGrant) {
      opts.logger.warn(
        {
          userId,
          scopeType: body.scope_type,
          scopeId: body.scope_id,
        },
        'usuario sin autoridad sobre scope solicitado',
      );
      return c.json({ error: 'forbidden_scope_authority', code: 'forbidden_scope_authority' }, 403);
    }

    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
    if (expiresAt && expiresAt <= new Date()) {
      return c.json({ error: 'expires_at_must_be_future', code: 'expires_at_must_be_future' }, 400);
    }

    // Evidencia Ley 21.719 (réplica del patrón de carrier_memberships,
    // me.ts:571-573). IP confiable = penúltima entry del XFF bajo GCLB
    // (extractClientIp); 'unknown' (sin XFF) se persiste como null.
    const trustedIp = extractClientIp(c.req.header('x-forwarded-for'));
    const grantIp = trustedIp === 'unknown' ? null : trustedIp;
    // Cap defensivo de longitud del UA (la columna es `text` sin límite): un
    // User-Agent arbitrariamente largo no debe inflar el audit log de evidencia.
    const rawUserAgent = c.req.header('user-agent');
    const grantUserAgent = rawUserAgent ? rawUserAgent.slice(0, 512) : null;

    const result = await grantConsent({
      db: opts.db,
      logger: opts.logger,
      grantedByUserId: userId,
      stakeholderId: body.stakeholder_id,
      scopeType: body.scope_type,
      scopeId: body.scope_id,
      dataCategories: body.data_categories as DataCategory[],
      expiresAt,
      consentDocumentUrl: body.consent_document_url,
      noticeVersion: body.notice_version ?? null,
      grantIp,
      grantUserAgent,
    });

    return c.json({ consent_id: result.consentId }, 201);
  });

  // PATCH /me/consents/:id/revoke
  app.patch('/:id/revoke', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userId = await resolveUserId(claims);
    if (!userId) {
      return c.json({ error: 'user_not_registered', code: 'user_not_registered' }, 404);
    }

    const consentId = c.req.param('id');
    // Zod en boundary (regla Booster): un :id no-UUID llegaría a Postgres y
    // produciría un 500 observable (oráculo malformado vs 404 vs 403). Validar
    // acá lo convierte en 400 limpio antes de tocar la BD.
    if (!z.string().uuid().safeParse(consentId).success) {
      return c.json({ error: 'invalid_consent_id', code: 'invalid_consent_id' }, 400);
    }

    // Pre-check: el consent debe existir y ser del actor (defense-in-depth
    // con la validación dentro de revokeConsent service). Sin esto, el
    // user A puede intentar revocar consents de user B y solo recibe
    // {revoked: false} sin error claro.
    const consentRow = await opts.db
      .select({ grantedByUserId: consents.grantedByUserId })
      .from(consents)
      .where(eq(consents.id, consentId))
      .limit(1);

    if (consentRow.length === 0) {
      return c.json({ error: 'consent_not_found', code: 'consent_not_found' }, 404);
    }
    if (consentRow[0]?.grantedByUserId !== userId) {
      return c.json({ error: 'forbidden_not_grantor', code: 'forbidden_not_grantor' }, 403);
    }

    const result = await revokeConsent({
      db: opts.db,
      logger: opts.logger,
      consentId,
      revokedByUserId: userId,
    });

    if (result.alreadyRevoked) {
      return c.json({
        consent_id: consentId,
        already_revoked: true,
      });
    }
    return c.json({ consent_id: consentId, revoked: true });
  });

  // GET /me/consents
  app.get('/', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userId = await resolveUserId(claims);
    if (!userId) {
      return c.json({ error: 'user_not_registered', code: 'user_not_registered' }, 404);
    }

    const includeInactive = c.req.query('include_inactive') === 'true';

    const list = await listConsentsGrantedBy({
      db: opts.db,
      grantedByUserId: userId,
      includeInactive,
    });

    return c.json({
      consents: list.map((item) => ({
        id: item.id,
        stakeholder_id: item.stakeholderId,
        stakeholder_organization_name: item.stakeholderOrgName,
        scope_type: item.scopeType,
        scope_id: item.scopeId,
        data_categories: item.dataCategories,
        granted_at: item.grantedAt.toISOString(),
        expires_at: item.expiresAt ? item.expiresAt.toISOString() : null,
        revoked_at: item.revokedAt ? item.revokedAt.toISOString() : null,
      })),
    });
  });

  return app;
}
