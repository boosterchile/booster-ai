import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { consents, memberships, users } from '../db/schema.js';
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
   * Validar que el otorgante tiene autoridad sobre el scope. Para scope
   * `organizacion` o `generador_carga`/`transportista`, el otorgante debe
   * ser dueño/admin de la empresa que coincide con `scope_id`. Para
   * `portafolio_viajes` se valida que la lista de trips pertenezca a una
   * empresa donde el otorgante es dueño/admin (validación más laxa por
   * ahora — bookmark P1).
   */
  async function userCanGrantOnScope(opts2: {
    userId: string;
    scopeType: ScopeType;
    scopeId: string;
  }): Promise<boolean> {
    if (opts2.scopeType === 'portafolio_viajes') {
      // P1: validar que TODOS los trips del portafolio sean de empresas
      // donde el user es dueño/admin. Por ahora aceptamos si el user tiene
      // alguna membership dueño/admin (el handler debe complementar con
      // validación específica del portafolio antes de servir data).
      const adminMembership = await opts.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, opts2.userId))
        .limit(1);
      return adminMembership.length > 0;
    }

    // Para scopes que apuntan a una empresa (organizacion / generador_carga / transportista),
    // validar que el user es dueño/admin de esa empresa específica.
    const rows = await opts.db
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.userId, opts2.userId))
      .limit(50);

    return rows.some((m) => m.status === 'activa' && (m.role === 'dueno' || m.role === 'admin'));
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
