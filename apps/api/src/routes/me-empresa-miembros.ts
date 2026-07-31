import type { Logger } from '@booster-ai/logger';
import { invitarMiembroSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { memberships, users } from '../db/schema.js';
import { generateActivationPin, hashActivationPin } from '../services/activation-pin.js';
import type { UserContext } from '../services/user-context.js';

/**
 * equipo-de-la-empresa Fase A — la empresa gestiona su propia gente.
 *
 *   GET  /me/empresa/miembros  → lista el equipo
 *   POST /me/empresa/miembros  → suma a alguien + código de activación
 *
 * **Por qué acá y no en el panel de Booster**: asignar personas a una empresa
 * es responsabilidad del cliente, no de la plataforma. El endpoint admin
 * equivalente (`/admin/empresas/:id/miembros`) queda como herramienta de
 * soporte para casos excepcionales.
 *
 * **Autorización**: sale de la membresía activa del caller (`userContext`).
 * El `empresaId` NUNCA viene del cliente — así no hay forma de sumar gente a
 * una empresa ajena, ni siquiera conociendo su id.
 *
 * **El código de activación no es una contraseña.** Se entrega a la empresa
 * para que se lo pase a la persona, sirve una sola vez y solo prueba
 * identidad; la clave la elige la persona al activar (`POST /auth/activar`).
 * Esa distinción es lo que separa este flujo del de conductores, donde el PIN
 * del admin termina siendo la credencial permanente (`auth-driver.ts:151`).
 */

/** Vencimiento del código: 7 días (decisión del PO — lo entrega la empresa en mano). */
const CODIGO_TTL_DIAS = 7;

/** Roles que pueden gestionar el equipo. El resto solo mira. */
const ROLES_QUE_GESTIONAN = new Set(['dueno', 'admin']);

function placeholderFirebaseUid(rut: string): string {
  return `pending-rut:${rut}`;
}

export function createMeEmpresaMiembrosRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requireEmpresa(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    const activa = userContext?.activeMembership;
    if (!userContext || !activa) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    // `empresa_id` es nullable por el CHECK XOR del schema: una membresía puede
    // pertenecer a una organización stakeholder (ADR-034) en vez de a una
    // empresa. Esos no gestionan equipo de empresa — fuera de alcance (spec §5).
    const empresaId = activa.membership.empresaId;
    if (!empresaId) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'no_es_empresa' }, 403),
      };
    }
    return {
      ok: true as const,
      empresaId,
      rol: activa.membership.role,
      callerId: userContext.user.id,
    };
  }

  app.get('/', async (c) => {
    const auth = requireEmpresa(c);
    if (!auth.ok) {
      return auth.response;
    }

    // rls-allowlist: filtrado por la empresa de la membresía activa del caller.
    const filas = await opts.db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        rut: users.rut,
        rol: memberships.role,
        estado: memberships.status,
        invitadoEn: memberships.invitedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.empresaId, auth.empresaId))
      .orderBy(desc(memberships.invitedAt))
      .limit(200);

    return c.json({
      miembros: filas.map((f) => ({
        membership_id: f.membershipId,
        user_id: f.userId,
        full_name: f.fullName,
        email: f.email,
        rut: f.rut,
        rol: f.rol,
        estado: f.estado,
        invitado_en: f.invitadoEn,
      })),
    });
  });

  app.post('/', zValidator('json', invitarMiembroSchema), async (c) => {
    const auth = requireEmpresa(c);
    if (!auth.ok) {
      return auth.response;
    }
    if (!ROLES_QUE_GESTIONAN.has(auth.rol)) {
      opts.logger.warn(
        { empresaId: auth.empresaId, rol: auth.rol },
        'me-empresa-miembros: rol sin permiso para gestionar el equipo',
      );
      return c.json({ error: 'forbidden', code: 'rol_sin_permiso' }, 403);
    }

    const body = c.req.valid('json');
    const email = body.email.toLowerCase();

    const codigo = generateActivationPin();
    const expiraEn = new Date(Date.now() + CODIGO_TTL_DIAS * 24 * 60 * 60 * 1000);

    const resultado = await opts.db.transaction(async (tx) => {
      // rls-allowlist: lookup global por RUT — una persona puede trabajar en
      // más de una empresa, así que su identidad se reusa en vez de duplicarse.
      const existentes = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.rut, body.rut))
        .limit(1);
      const existente = existentes[0];

      if (existente) {
        const yaMiembro = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(eq(memberships.userId, existente.id), eq(memberships.empresaId, auth.empresaId)),
          )
          .limit(1);
        if (yaMiembro[0]) {
          return { conflicto: 'already_member' as const, membershipId: yaMiembro[0].id };
        }
      }

      let userId: string;
      if (existente) {
        userId = existente.id;
        // Persona ya conocida: solo se le habilita el código para esta empresa.
        // NO se toca su email ni su clave — su identidad es suya.
        await tx
          .update(users)
          .set({ activationPinHash: hashActivationPin(codigo), updatedAt: new Date() })
          .where(eq(users.id, userId));
      } else {
        const insertados = await tx
          .insert(users)
          .values({
            firebaseUid: placeholderFirebaseUid(body.rut),
            // Email REAL: es el canal de la plataforma con la persona (spec
            // §6.1). Nunca un `@…invalid`.
            email,
            fullName: body.full_name,
            rut: body.rut,
            activationPinHash: hashActivationPin(codigo),
            status: 'pendiente_verificacion',
            isPlatformAdmin: false,
          })
          .returning({ id: users.id });
        const creado = insertados[0];
        if (!creado) {
          throw new Error('insert user devolvió vacío');
        }
        userId = creado.id;
      }

      const membresias = await tx
        .insert(memberships)
        .values({
          userId,
          empresaId: auth.empresaId,
          role: body.rol,
          // Pendiente hasta que la persona active con su propia clave.
          status: 'pendiente_invitacion',
          invitedByUserId: auth.callerId,
          invitedAt: new Date(),
          joinedAt: null,
        })
        .returning({ id: memberships.id });
      const membresia = membresias[0];
      if (!membresia) {
        throw new Error('insert membresía devolvió vacío');
      }

      return { userId, membershipId: membresia.id };
    });

    if ('conflicto' in resultado) {
      return c.json(
        { error: 'conflict', code: 'already_member', membership_id: resultado.membershipId },
        409,
      );
    }

    opts.logger.info(
      {
        empresaId: auth.empresaId,
        userId: resultado.userId,
        membershipId: resultado.membershipId,
        rol: body.rol,
        invitadoPor: auth.callerId,
      },
      'me-empresa-miembros: miembro agregado al equipo',
    );

    // El código viaja SOLO acá, a quien lo dio de alta. No se loguea ni se
    // persiste en claro: en la BD queda su hash.
    return c.json(
      {
        ok: true,
        user_id: resultado.userId,
        membership_id: resultado.membershipId,
        rol: body.rol,
        estado: 'pendiente_invitacion',
        codigo_activacion: codigo,
        expira_en: expiraEn.toISOString(),
      },
      201,
    );
  });

  return app;
}
