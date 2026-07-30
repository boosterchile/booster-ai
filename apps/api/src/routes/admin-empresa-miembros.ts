import type { Logger } from '@booster-ai/logger';
import { invitarMiembroEmpresaSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { empresas, memberships, users } from '../db/schema.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';

/**
 * Fase 3.5 (onboarding-flow-redesign) — sumar personas a una empresa EXISTENTE.
 *
 *   POST /admin/empresas/:id/miembros → invita a alguien con un rol
 *
 * **Por qué existe**: `onboardEmpresa` solo sabe crear empresa + dueño de cero.
 * Con el RUT ya registrado devuelve 409 `rut_already_registered`
 * (`services/onboarding.ts`), así que la segunda persona de un cliente no tenía
 * camino de producto: se resolvía con INSERT a mano en prod. Caso que lo
 * motivó: el gestor de Transportes Van Oosterwyk, empresa dada de alta en mayo
 * con flota y conductores cargados, cuyo único acceso era una cuenta de Booster
 * dentro del tenant del cliente.
 *
 * **Diferencia con `admin-stakeholder-orgs.ts`** (mismo patrón, un escalón
 * mejor): aquel crea un usuario placeholder con `firebase_uid = pending-rut:…`
 * y deja el acceso "fuera de banda". Acá se crea la cuenta Firebase real y se
 * devuelve el link de acceso (mismo mecanismo que T2.0), porque una membresía
 * sin forma de entrar no sirve de nada.
 *
 * **Estado de la membresía**: `activa`, no `pendiente_invitacion`. El invitado
 * debe poder operar apenas fija su contraseña; una membresía pendiente lo
 * dejaría entrando a una app vacía (el `userContext` resuelve empresa activa
 * sobre membresías activas). La trazabilidad de la invitación queda igual en
 * `invitado_por_id` / `invitado_en`, y `unido_en` se mantiene null hasta que
 * la persona entre.
 *
 * Audiencia: platform-admin (allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`).
 */
export function createAdminEmpresaMiembrosRoutes(opts: {
  db: Db;
  logger: Logger;
  auth: Auth;
}): Hono {
  const app = new Hono();

  // GET /admin/empresas — listado para elegir destino de la invitación. Sin
  // esto el admin tendría que conocer el UUID de la empresa de memoria.
  app.get('/', async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const rows = await opts.db
      .select({
        id: empresas.id,
        razonSocial: empresas.legalName,
        rut: empresas.rut,
        estado: empresas.status,
        esTransportista: empresas.isTransportista,
        esGeneradorCarga: empresas.isGeneradorCarga,
      })
      .from(empresas)
      .orderBy(empresas.legalName)
      .limit(500);

    return c.json({
      empresas: rows.map((r) => ({
        id: r.id,
        razon_social: r.razonSocial,
        rut: r.rut,
        estado: r.estado,
        es_transportista: r.esTransportista,
        es_generador_carga: r.esGeneradorCarga,
      })),
    });
  });

  app.post('/:id/miembros', zValidator('json', invitarMiembroEmpresaSchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    const empresaId = c.req.param('id');
    if (!z.string().uuid().safeParse(empresaId).success) {
      return c.json({ error: 'invalid_id', code: 'invalid_id' }, 400);
    }
    const body = c.req.valid('json');
    const email = body.email.toLowerCase();

    // La empresa se valida ANTES de tocar Firebase: crear la cuenta y después
    // descubrir que la empresa no existe dejaría un usuario huérfano que nadie
    // limpia (el reaper T1.7 solo persigue huérfanos del flujo con token).
    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const empresaRows = await opts.db
      .select({ id: empresas.id, razonSocial: empresas.legalName })
      .from(empresas)
      .where(eq(empresas.id, empresaId))
      .limit(1);
    const empresa = empresaRows[0];
    if (!empresa) {
      return c.json({ error: 'not_found', code: 'empresa_not_found' }, 404);
    }

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const existingUsers = await opts.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const existingUser = existingUsers[0];

    if (existingUser) {
      // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
      const existingMembership = await opts.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, existingUser.id), eq(memberships.empresaId, empresaId)))
        .limit(1);
      if (existingMembership[0]) {
        return c.json(
          {
            error: 'conflict',
            code: 'already_member',
            membership_id: existingMembership[0].id,
          },
          409,
        );
      }
    }

    // Cuenta Firebase solo para emails nuevos: si la persona ya existe en la
    // plataforma (p.ej. trabaja en dos empresas), se le suma la membresía sin
    // duplicar su identidad.
    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      let firebaseUid: string;
      try {
        const fbUser = await opts.auth.createUser({
          email,
          displayName: body.full_name,
          emailVerified: false,
        });
        firebaseUid = fbUser.uid;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === 'auth/email-already-exists') {
          // Existe en Firebase pero no en nuestra BD (alta a medias previa).
          // No lo resolvemos por adivinanza: que el admin lo revise.
          opts.logger.warn(
            { empresaId, firebaseErrorCode: code },
            'admin-empresa-miembros: email ya existe en Firebase sin fila en usuarios',
          );
          return c.json({ error: 'conflict', code: 'firebase_user_already_exists' }, 409);
        }
        opts.logger.error({ err, empresaId }, 'admin-empresa-miembros: Firebase createUser falló');
        return c.json({ error: 'service_unavailable', code: 'firebase_unavailable' }, 503);
      }

      const inserted = await opts.db
        .insert(users)
        .values({
          firebaseUid,
          email,
          fullName: body.full_name,
          status: 'activo',
          isPlatformAdmin: false,
        })
        .returning({ id: users.id });
      const created = inserted[0];
      if (!created) {
        opts.logger.error({ empresaId, firebaseUid }, 'admin-empresa-miembros: insert user vacío');
        return c.json({ error: 'internal_server_error', code: 'user_create_failed' }, 500);
      }
      userId = created.id;
    }

    const insertedMembership = await opts.db
      .insert(memberships)
      .values({
        userId,
        empresaId,
        role: body.rol,
        status: 'activa',
        invitedByUserId: admin.userContext.user.id,
        invitedAt: new Date(),
        joinedAt: null,
      })
      .returning({ id: memberships.id });
    const membership = insertedMembership[0];
    if (!membership) {
      opts.logger.error({ empresaId, userId }, 'admin-empresa-miembros: insert membresía vacío');
      return c.json({ error: 'internal_server_error', code: 'membership_create_failed' }, 500);
    }

    // Link de acceso (T2.0): la cuenta no tiene contraseña ni email verificado.
    // Degrada sin romper — la membresía ya existe y el admin puede disparar el
    // reset desde el login. El link NUNCA se loguea: es credencial de un uso.
    let accessLink: string | undefined;
    try {
      accessLink = await opts.auth.generatePasswordResetLink(email);
    } catch (err) {
      opts.logger.error(
        { err, empresaId, userId },
        'admin-empresa-miembros: generatePasswordResetLink falló; miembro creado sin link',
      );
    }

    opts.logger.info(
      {
        empresaId,
        empresaRazonSocial: empresa.razonSocial,
        userId,
        membershipId: membership.id,
        rol: body.rol,
        invitedBy: admin.adminEmail,
        accessLinkIssued: accessLink !== undefined,
      },
      'admin-empresa-miembros: miembro agregado a empresa existente',
    );

    return c.json(
      {
        ok: true,
        user_id: userId,
        membership_id: membership.id,
        rol: body.rol,
        estado: 'activa',
        ...(accessLink ? { access_link: accessLink } : {}),
      },
      201,
    );
  });

  return app;
}
