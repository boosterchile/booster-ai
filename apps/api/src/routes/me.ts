import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { empresas, memberships, users } from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';

/**
 * GET /me
 *
 * Endpoint que el cliente web llama inmediatamente después del login con
 * Firebase. A diferencia de los demás endpoints protegidos, este NO usa el
 * userContextMiddleware — porque el user puede no existir en la DB todavía
 * (acaba de registrarse en Firebase pero aún no completó el onboarding de
 * empresa). En ese caso devolvemos `needs_onboarding=true` para que el
 * cliente sepa que tiene que redirigir al flow.
 *
 * Cuerpo de respuesta:
 *
 *   - User registrado:
 *     {
 *       needs_onboarding: false,
 *       user: { id, email, fullName, ... },
 *       memberships: [ { id, role, empresa: { id, legalName, ... } } ],
 *       activeMembership: { ... | null }
 *     }
 *
 *   - User en Firebase pero no en nuestra DB:
 *     {
 *       needs_onboarding: true,
 *       firebase: { uid, email, name, picture }
 *     }
 *
 * Solo aplica el firebaseAuth middleware (no el userContext) al montarlo
 * desde server.ts.
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
      // User en Firebase pero no en DB — el cliente debe llevarlo a
      // onboarding para crear empresa + user en una sola transacción.
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

    // Cargar memberships activas con join a empresas.
    const rows = await opts.db
      .select({ membership: memberships, empresa: empresas })
      .from(memberships)
      .innerJoin(empresas, eq(memberships.empresaId, empresas.id))
      .where(eq(memberships.userId, user.id));

    // Mapear a forma que el cliente entiende (camelCase, sin internals DB).
    const membershipsPayload = rows.map((r) => ({
      id: r.membership.id,
      role: r.membership.role,
      status: r.membership.status,
      joined_at: r.membership.joinedAt,
      empresa: {
        id: r.empresa.id,
        legal_name: r.empresa.legalName,
        rut: r.empresa.rut,
        is_shipper: r.empresa.isShipper,
        is_carrier: r.empresa.isCarrier,
        status: r.empresa.status,
      },
    }));

    // X-Empresa-Id resuelve cuál es la activa. Si no viene, default a la
    // primera membership activa (si existe).
    const requestedEmpresaId = c.req.header('x-empresa-id');
    const activeMembershipsList = membershipsPayload.filter((m) => m.status === 'active');
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
        rut: user.rut,
        is_platform_admin: user.isPlatformAdmin,
        status: user.status,
      },
      memberships: membershipsPayload,
      active_membership: active,
    });
  });

  return app;
}
