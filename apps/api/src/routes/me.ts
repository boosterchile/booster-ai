import type { Logger } from '@booster-ai/logger';
import { profileUpdateInputSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { empresas, memberships, users } from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';

/**
 * GET /me — endpoint que el cliente web llama post-login con Firebase.
 * No usa userContext middleware porque el user puede no existir todavía.
 *
 * PATCH /me/profile — actualización parcial. RUT inmutable si ya está
 * declarado.
 */
export function createMeRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me hit without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userRows = await opts.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = userRows[0];

    if (!user) {
      return c.json({
        needs_onboarding: true,
        firebase: {
          uid: claims.uid,
          email: claims.email,
          name: claims.name,
          picture: claims.picture,
          email_verified: claims.emailVerified,
        },
      });
    }

    const rows = await opts.db
      .select({ membership: memberships, empresa: empresas })
      .from(memberships)
      .innerJoin(empresas, eq(memberships.empresaId, empresas.id))
      .where(eq(memberships.userId, user.id));

    const membershipsPayload = rows.map((r) => ({
      id: r.membership.id,
      role: r.membership.role,
      status: r.membership.status,
      joined_at: r.membership.joinedAt,
      empresa: {
        id: r.empresa.id,
        legal_name: r.empresa.legalName,
        rut: r.empresa.rut,
        is_generador_carga: r.empresa.isGeneradorCarga,
        is_transportista: r.empresa.isTransportista,
        status: r.empresa.status,
      },
    }));

    const requestedEmpresaId = c.req.header('x-empresa-id');
    const activeMembershipsList = membershipsPayload.filter((m) => m.status === 'activa');
    let active: (typeof membershipsPayload)[number] | null = null;
    if (requestedEmpresaId) {
      active = activeMembershipsList.find((m) => m.empresa.id === requestedEmpresaId) ?? null;
    } else if (activeMembershipsList.length > 0) {
      active = activeMembershipsList[0] ?? null;
    }

    return c.json({
      needs_onboarding: false,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        phone: user.phone,
        whatsapp_e164: user.whatsappE164,
        rut: user.rut,
        is_platform_admin: user.isPlatformAdmin,
        status: user.status,
      },
      memberships: membershipsPayload,
      active_membership: active,
    });
  });

  app.patch('/profile', zValidator('json', profileUpdateInputSchema), async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me/profile hit without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userRows = await opts.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json(
        {
          error: 'user_not_found',
          message: 'El usuario no existe en la DB. Completa onboarding primero.',
        },
        404,
      );
    }

    const input = c.req.valid('json');

    if (input.rut !== undefined && user.rut !== null) {
      return c.json(
        {
          error: 'rut_immutable',
          message: 'El RUT ya está declarado. Para cambiarlo, contacta soporte.',
        },
        409,
      );
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.full_name !== undefined) {
      patch.fullName = input.full_name;
    }
    if (input.phone !== undefined) {
      patch.phone = input.phone;
    }
    if (input.whatsapp_e164 !== undefined) {
      patch.whatsappE164 = input.whatsapp_e164;
    }
    if (input.rut !== undefined) {
      patch.rut = input.rut;
    }

    const updatedRows = await opts.db
      .update(users)
      .set(patch)
      .where(eq(users.id, user.id))
      .returning();
    const updated = updatedRows[0];
    if (!updated) {
      opts.logger.error({ userId: user.id }, '/me/profile UPDATE returning empty');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    return c.json({
      user: {
        id: updated.id,
        email: updated.email,
        full_name: updated.fullName,
        phone: updated.phone,
        whatsapp_e164: updated.whatsappE164,
        rut: updated.rut,
        is_platform_admin: updated.isPlatformAdmin,
        status: updated.status,
      },
    });
  });

  return app;
}
