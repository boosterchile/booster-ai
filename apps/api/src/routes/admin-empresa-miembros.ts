import type { Logger } from '@booster-ai/logger';
import {
  empresaEstadoPatchSchema,
  empresaStatusSchema,
  invitarMiembroEmpresaSchema,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { empresas, memberships, users } from '../db/schema.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { generateActivationPin, hashActivationPin } from '../services/activation-pin.js';

/**
 * Fase 3.5 (onboarding-flow-redesign) — sumar personas a una empresa EXISTENTE.
 *
 *   GET   /admin/empresas              → lista (filtro opcional `?estado=`)
 *   PATCH /admin/empresas/:id          → cambia `estado` (activa / suspendida /
 *                                        pendiente_verificacion)
 *   POST  /admin/empresas/:id/miembros → invita a alguien con un rol
 *
 * **Por qué existe**: `onboardEmpresa` solo sabe crear empresa + dueño de cero.
 * Con el RUT ya registrado devuelve 409 `rut_already_registered`
 * (`services/onboarding.ts`), así que la segunda persona de un cliente no tenía
 * camino de producto: se resolvía con INSERT a mano en prod. Caso que lo
 * motivó: el gestor de Transportes Van Oosterwyk, empresa dada de alta en mayo
 * con flota y conductores cargados, cuyo único acceso era una cuenta de Booster
 * dentro del tenant del cliente.
 *
 * **Mismo mecanismo que `POST /me/empresa/miembros`**: no se crea la cuenta
 * Firebase con el correo real ni se devuelve un reset de contraseña. Se emite
 * un código de 6 dígitos (hash en `activation_pin_hash`). La persona lo usa en
 * `POST /auth/activar` junto con el RUT y elige su clave. El código no queda
 * como contraseña y no se loguea.
 *
 * **Estado de la membresía**: `pendiente_invitacion` hasta que active. Ahí
 * `/auth/activar` la pasa a `activa`. La trazabilidad queda en
 * `invitado_por_id` / `invitado_en`.
 *
 * Audiencia: platform-admin (allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`).
 */
export function createAdminEmpresaMiembrosRoutes(opts: {
  db: Db;
  logger: Logger;
  auth: Auth;
}): Hono {
  const app = new Hono();

  const listQuerySchema = z.object({
    estado: empresaStatusSchema.optional(),
  });

  const idParamSchema = z.object({ id: z.string().uuid() });

  // GET /admin/empresas — listado para elegir destino de la invitación y para
  // activar/suspender. Sin esto el admin tendría que conocer el UUID de
  // memoria o filtrar a mano en SQL.
  app.get('/', zValidator('query', listQuerySchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    const { estado } = c.req.valid('query');

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const base = opts.db
      .select({
        id: empresas.id,
        razonSocial: empresas.legalName,
        rut: empresas.rut,
        estado: empresas.status,
        esTransportista: empresas.isTransportista,
        esGeneradorCarga: empresas.isGeneradorCarga,
      })
      .from(empresas);

    const rows = estado
      ? await base.where(eq(empresas.status, estado)).orderBy(empresas.legalName).limit(500)
      : await base.orderBy(empresas.legalName).limit(500);

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

  // PATCH /admin/empresas/:id — cambia estado. Cierra el hueco 0→1: el
  // onboarding deja `pendiente_verificacion` y matching exige `activa`.
  // Sin este endpoint ops activaba con SQL.
  //
  // Transiciones: los tres valores del enum son alcanzables entre sí.
  // No hay transición ilegal. Mismo valor = 200 idempotente.
  app.patch(
    '/:id',
    zValidator('param', idParamSchema),
    zValidator('json', empresaEstadoPatchSchema),
    async (c) => {
      const admin = requirePlatformAdmin(c);
      if (!admin.ok) {
        return admin.response;
      }

      const { id } = c.req.valid('param');
      const { estado: nuevoEstado } = c.req.valid('json');

      return await withBusinessSpan(
        {
          name: 'empresa.cambiar_estado',
          attributes: {
            'booster.empresa_id': id,
            'booster.empresa.estado_nuevo': nuevoEstado,
          },
        },
        async (span) => {
          // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
          const existingRows = await opts.db
            .select({
              id: empresas.id,
              status: empresas.status,
            })
            .from(empresas)
            .where(eq(empresas.id, id))
            .limit(1);
          const existing = existingRows[0];
          if (!existing) {
            return c.json({ error: 'not_found', code: 'empresa_not_found' }, 404);
          }

          const estadoAnterior = existing.status;
          const unchanged = estadoAnterior === nuevoEstado;

          if (!unchanged) {
            // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
            const updated = await opts.db
              .update(empresas)
              .set({ status: nuevoEstado, updatedAt: new Date() })
              .where(eq(empresas.id, id))
              .returning({ id: empresas.id, status: empresas.status });
            if (!updated[0]) {
              opts.logger.error(
                { empresaId: id, nuevoEstado },
                'admin-empresas: UPDATE estado no devolvió fila',
              );
              return c.json({ error: 'internal_server_error', code: 'estado_update_failed' }, 500);
            }
          }

          opts.logger.info(
            {
              empresaId: id,
              estadoAnterior,
              estadoNuevo: nuevoEstado,
              unchanged,
              adminEmail: admin.adminEmail,
              actorUserId: admin.userContext.user.id,
            },
            unchanged
              ? 'admin-empresas: estado sin cambio (idempotente)'
              : 'admin-empresas: estado actualizado',
          );

          getBusinessCounter('empresa_estado_cambios_total').add(1, {
            from: estadoAnterior,
            to: nuevoEstado,
            unchanged: String(unchanged),
          });
          setResultAttributes(span, {
            'booster.empresa.estado_anterior': estadoAnterior,
            'booster.empresa.unchanged': unchanged,
          });

          return c.json({
            ok: true,
            id,
            estado: nuevoEstado,
            estado_anterior: estadoAnterior,
            unchanged,
          });
        },
      );
    },
  );

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
    const codigo = generateActivationPin();
    const expiraEn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return await withBusinessSpan(
      {
        name: 'alta.invitar_miembro',
        attributes: { 'booster.empresa_id': empresaId, 'alta.rol': body.rol },
      },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('alta_invitacion_admin_total').add(1, { resultado });
          setResultAttributes(span, { 'alta.resultado': resultado });
        };

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const empresaRows = await opts.db
          .select({ id: empresas.id, razonSocial: empresas.legalName })
          .from(empresas)
          .where(eq(empresas.id, empresaId))
          .limit(1);
        const empresa = empresaRows[0];
        if (!empresa) {
          record('empresa_not_found');
          return c.json({ error: 'not_found', code: 'empresa_not_found' }, 404);
        }

        // La identidad es el RUT, igual que el alta que hace la propia empresa.
        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const porRut = await opts.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.rut, body.rut))
          .limit(1);
        const existente = porRut[0];

        let userId: string;
        if (existente) {
          // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
          const existingMembership = await opts.db
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eq(memberships.userId, existente.id), eq(memberships.empresaId, empresaId)))
            .limit(1);
          if (existingMembership[0]) {
            record('already_member');
            return c.json(
              {
                error: 'conflict',
                code: 'already_member',
                membership_id: existingMembership[0].id,
              },
              409,
            );
          }
          await opts.db
            .update(users)
            .set({ activationPinHash: hashActivationPin(codigo), updatedAt: new Date() })
            .where(eq(users.id, existente.id));
          userId = existente.id;
        } else {
          // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
          const porEmail = await opts.db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
          if (porEmail[0]) {
            record('email_already_registered');
            return c.json({ error: 'conflict', code: 'email_already_registered' }, 409);
          }

          const inserted = await opts.db
            .insert(users)
            .values({
              firebaseUid: `pending-rut:${body.rut}`,
              email,
              fullName: body.full_name,
              rut: body.rut,
              activationPinHash: hashActivationPin(codigo),
              status: 'pendiente_verificacion',
              isPlatformAdmin: false,
            })
            .returning({ id: users.id });
          const created = inserted[0];
          if (!created) {
            opts.logger.error({ empresaId }, 'admin-empresa-miembros: insert user vacío');
            record('user_create_failed');
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
            status: 'pendiente_invitacion',
            invitedByUserId: admin.userContext.user.id,
            invitedAt: new Date(),
            joinedAt: null,
          })
          .returning({ id: memberships.id });
        const membership = insertedMembership[0];
        if (!membership) {
          opts.logger.error(
            { empresaId, userId },
            'admin-empresa-miembros: insert membresía vacío',
          );
          record('membership_create_failed');
          return c.json({ error: 'internal_server_error', code: 'membership_create_failed' }, 500);
        }

        opts.logger.info(
          {
            empresaId,
            userId,
            membershipId: membership.id,
            rol: body.rol,
            invitedBy: admin.adminEmail,
          },
          'admin-empresa-miembros: invitación emitida (código no logueado)',
        );
        record('issued');

        return c.json(
          {
            ok: true,
            user_id: userId,
            membership_id: membership.id,
            rol: body.rol,
            estado: 'pendiente_invitacion',
            codigo_activacion: codigo,
            expira_en: expiraEn.toISOString(),
          },
          201,
        );
      },
    );
  });

  return app;
}
