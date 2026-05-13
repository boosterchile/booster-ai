import type { Logger } from '@booster-ai/logger';
import {
  crearOrganizacionStakeholderSchema,
  invitarMiembroOrgStakeholderSchema,
  rutSchema,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { memberships, organizacionesStakeholder, users } from '../db/schema.js';
import type { UserContext } from '../services/user-context.js';

const PENDING_FIREBASE_UID_PREFIX = 'pending-rut:';

/**
 * Endpoints admin para gestión de organizaciones stakeholder (ADR-034).
 *
 * Audiencia: platform-admin de Booster Chile SpA (allowlist
 * `BOOSTER_PLATFORM_ADMIN_EMAILS`).
 *
 *   GET    /admin/stakeholder-orgs                   → lista
 *   POST   /admin/stakeholder-orgs                   → crear
 *   GET    /admin/stakeholder-orgs/:id               → detalle (con miembros)
 *   POST   /admin/stakeholder-orgs/:id/invitar       → invitar miembro
 *   DELETE /admin/stakeholder-orgs/:id               → soft-delete
 *
 * Invariante: una membership con `organizacion_stakeholder_id` setado
 * tiene `empresa_id = NULL` (DB CHECK XOR). El rol siempre es
 * `stakeholder_sostenibilidad` para members de orgs stakeholder.
 *
 * Auditoría: logger structured con `event_type` org_stakeholder.*.
 * Si Felipe quiere persistir en tabla `eventos` después, se agrega.
 */

const STAKEHOLDER_MEMBERSHIP_ROLE = 'stakeholder_sostenibilidad' as const;

export function createAdminStakeholderOrgsRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const email = userContext.user.email?.toLowerCase();
    const allowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
    if (!email || !allowlist.includes(email)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden_platform_admin' }, 403),
      };
    }
    return { ok: true as const, userContext, adminEmail: email, adminUserId: userContext.user.id };
  }

  // GET /admin/stakeholder-orgs?include_deleted=false
  app.get('/', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const includeDeleted = c.req.query('include_deleted') === 'true';

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const baseQuery = opts.db.select().from(organizacionesStakeholder);
    const filteredQuery = includeDeleted
      ? baseQuery
      : baseQuery.where(isNull(organizacionesStakeholder.deletedAt));
    const rows = await filteredQuery.orderBy(desc(organizacionesStakeholder.createdAt)).limit(500);

    return c.json({
      organizations: rows.map((r) => ({
        id: r.id,
        nombre_legal: r.nombreLegal,
        tipo: r.tipo,
        region_ambito: r.regionAmbito,
        sector_ambito: r.sectorAmbito,
        creado_por_admin_id: r.createdByAdminId,
        creado_en: r.createdAt.toISOString(),
        actualizado_en: r.updatedAt.toISOString(),
        eliminado_en: r.deletedAt?.toISOString() ?? null,
      })),
    });
  });

  // POST /admin/stakeholder-orgs
  app.post('/', zValidator('json', crearOrganizacionStakeholderSchema), async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');

    const [created] = await opts.db
      .insert(organizacionesStakeholder)
      .values({
        nombreLegal: body.nombre_legal,
        tipo: body.tipo,
        regionAmbito: body.region_ambito ?? null,
        sectorAmbito: body.sector_ambito ?? null,
        createdByAdminId: auth.adminUserId,
      })
      .returning();

    if (!created) {
      // Drizzle returning() can theoretically return empty if the row was
      // intercepted by a trigger/policy; defensa explícita.
      return c.json({ error: 'create_failed' }, 500);
    }

    opts.logger.info(
      {
        event_type: 'org_stakeholder.created',
        org_id: created.id,
        tipo: created.tipo,
        admin_email: auth.adminEmail,
      },
      'org_stakeholder.created',
    );

    return c.json(
      {
        id: created.id,
        nombre_legal: created.nombreLegal,
        tipo: created.tipo,
        region_ambito: created.regionAmbito,
        sector_ambito: created.sectorAmbito,
        creado_por_admin_id: created.createdByAdminId,
        creado_en: created.createdAt.toISOString(),
        actualizado_en: created.updatedAt.toISOString(),
        eliminado_en: null,
      },
      201,
    );
  });

  // GET /admin/stakeholder-orgs/:id  (con miembros)
  app.get('/:id', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const orgId = c.req.param('id');
    if (!z.string().uuid().safeParse(orgId).success) {
      return c.json({ error: 'invalid_id' }, 400);
    }

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const orgRows = await opts.db
      .select()
      .from(organizacionesStakeholder)
      .where(eq(organizacionesStakeholder.id, orgId))
      .limit(1);
    const org = orgRows[0];
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const memberRows = await opts.db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        rut: users.rut,
        email: users.email,
        fullName: users.fullName,
        status: memberships.status,
        invitedAt: memberships.invitedAt,
        joinedAt: memberships.joinedAt,
        firebaseUid: users.firebaseUid,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.organizacionStakeholderId, orgId));

    return c.json({
      id: org.id,
      nombre_legal: org.nombreLegal,
      tipo: org.tipo,
      region_ambito: org.regionAmbito,
      sector_ambito: org.sectorAmbito,
      creado_por_admin_id: org.createdByAdminId,
      creado_en: org.createdAt.toISOString(),
      actualizado_en: org.updatedAt.toISOString(),
      eliminado_en: org.deletedAt?.toISOString() ?? null,
      miembros: memberRows.map((m) => ({
        membership_id: m.membershipId,
        user_id: m.userId,
        rut: m.rut,
        email: m.email,
        full_name: m.fullName,
        status: m.status,
        is_pending: m.firebaseUid.startsWith(PENDING_FIREBASE_UID_PREFIX),
        invitado_en: m.invitedAt.toISOString(),
        unido_en: m.joinedAt?.toISOString() ?? null,
      })),
    });
  });

  // POST /admin/stakeholder-orgs/:id/invitar
  app.post('/:id/invitar', zValidator('json', invitarMiembroOrgStakeholderSchema), async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const orgId = c.req.param('id');
    if (!z.string().uuid().safeParse(orgId).success) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    const body = c.req.valid('json');

    // Normalizar RUT.
    const rutParsed = rutSchema.safeParse(body.rut);
    if (!rutParsed.success) {
      return c.json({ error: 'invalid_rut', details: rutParsed.error.format() }, 400);
    }
    const rut = rutParsed.data;

    // Verificar que la org exista y no esté eliminada.
    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const orgRows = await opts.db
      .select({ id: organizacionesStakeholder.id, deletedAt: organizacionesStakeholder.deletedAt })
      .from(organizacionesStakeholder)
      .where(eq(organizacionesStakeholder.id, orgId))
      .limit(1);
    const org = orgRows[0];
    if (!org || org.deletedAt != null) {
      return c.json({ error: 'org_not_found' }, 404);
    }

    // Buscar usuario existente por RUT.
    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const existingUsers = await opts.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.rut, rut))
      .limit(1);
    let userId: string;
    if (existingUsers[0]) {
      userId = existingUsers[0].id;
    } else {
      // Crear placeholder user. firebase_uid es `pending-rut:<rut>` hasta
      // que active sus credenciales. Auth de stakeholder pre-Wave 4 es
      // email/password — el admin asignará la primera password al user
      // por canal seguro fuera de banda (o el user usará reset password).
      const [created] = await opts.db
        .insert(users)
        .values({
          firebaseUid: `${PENDING_FIREBASE_UID_PREFIX}${rut}`,
          email: body.email,
          fullName: body.full_name,
          rut,
          status: 'pendiente_verificacion',
        })
        .returning({ id: users.id });
      if (!created) {
        return c.json({ error: 'user_create_failed' }, 500);
      }
      userId = created.id;
    }

    // Verificar que no exista ya una membership para este user+org.
    const existingMembership = await opts.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizacionStakeholderId, orgId)))
      .limit(1);
    if (existingMembership[0]) {
      return c.json({ error: 'already_member', membership_id: existingMembership[0].id }, 409);
    }

    // Crear membership pending. Status `activa` cuando el user complete
    // auth (post-Wave 4 será automático tras login universal).
    const [membership] = await opts.db
      .insert(memberships)
      .values({
        userId,
        empresaId: null,
        organizacionStakeholderId: orgId,
        role: STAKEHOLDER_MEMBERSHIP_ROLE,
        status: 'pendiente_invitacion',
        invitedByUserId: auth.adminUserId,
      })
      .returning({ id: memberships.id });
    if (!membership) {
      return c.json({ error: 'membership_create_failed' }, 500);
    }

    opts.logger.info(
      {
        event_type: 'org_stakeholder.member_invited',
        org_id: orgId,
        user_id: userId,
        rut,
        admin_email: auth.adminEmail,
      },
      'org_stakeholder.member_invited',
    );

    return c.json(
      {
        membership_id: membership.id,
        user_id: userId,
        rut,
        email: body.email,
        full_name: body.full_name,
        status: 'pendiente_invitacion',
      },
      201,
    );
  });

  // DELETE /admin/stakeholder-orgs/:id  (soft-delete)
  app.delete('/:id', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const orgId = c.req.param('id');
    if (!z.string().uuid().safeParse(orgId).success) {
      return c.json({ error: 'invalid_id' }, 400);
    }

    // rls-allowlist: admin platform-wide soft-delete — protegido por requirePlatformAdmin.
    const result = await opts.db
      .update(organizacionesStakeholder)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(eq(organizacionesStakeholder.id, orgId), isNull(organizacionesStakeholder.deletedAt)),
      )
      .returning({ id: organizacionesStakeholder.id });

    if (result.length === 0) {
      return c.json({ error: 'not_found_or_already_deleted' }, 404);
    }

    opts.logger.info(
      {
        event_type: 'org_stakeholder.soft_deleted',
        org_id: orgId,
        admin_email: auth.adminEmail,
      },
      'org_stakeholder.soft_deleted',
    );

    return c.json({ ok: true, id: orgId });
  });

  return app;
}
