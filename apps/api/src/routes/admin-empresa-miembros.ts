import type { Logger } from '@booster-ai/logger';
import {
  type MiembroPendienteAdmin,
  crearEmpresaAdminSchema,
  empresaEstadoPatchSchema,
  empresaStatusSchema,
  invitarMiembroEmpresaSchema,
  reemitirCodigoActivacionResponseSchema,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { esRutDuplicado } from '../db/pg-error.js';
import { carrierMemberships, empresas, memberships, plans, users } from '../db/schema.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { generateActivationPin, hashActivationPin } from '../services/activation-pin.js';
import { enviarCorreoActivacionCuenta } from '../services/notifications/cuenta-activacion-email.js';
import type { EmailSender } from '../services/notifications/email-sender.js';
import { type VinculoPersona, clasificarVinculoPersona } from '../services/vinculo-persona.js';

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function fechaDe(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function miembroPendienteDe(row: {
  userId: string;
  membershipId: string;
  nombre: string;
  rut: string | null;
  email: string;
  rol: MiembroPendienteAdmin['rol'];
  invitadoEn: Date | string;
}): MiembroPendienteAdmin {
  const invitado = fechaDe(row.invitadoEn);
  return {
    user_id: row.userId,
    membership_id: row.membershipId,
    nombre: row.nombre,
    rut: row.rut ?? '',
    email: row.email,
    rol: row.rol,
    invitado_en: invitado.toISOString(),
    expira_en: new Date(invitado.getTime() + SIETE_DIAS_MS).toISOString(),
  };
}

/**
 * Fase 3.5 (onboarding-flow-redesign) — sumar personas a una empresa EXISTENTE.
 *
 *   GET   /admin/empresas              → lista (filtro opcional `?estado=`)
 *                                        con las invitaciones pendientes
 *   POST  /admin/empresas              → crea la ficha legal (generador y/o
 *                                        transportista), sin persona ni clave
 *   PATCH /admin/empresas/:id          → cambia `estado` (activa / suspendida /
 *                                        pendiente_verificacion)
 *   POST  /admin/empresas/:id/miembros → invita a alguien con un rol
 *   POST  /admin/empresas/:id/miembros/:membershipId/codigo
 *                                      → emite un código nuevo para una
 *                                        invitación que sigue pendiente
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
  /**
   * T10-04 (ADR-082) — envía el código de activación al correo de la persona.
   * Ausente en tests que no lo ejercitan; en prod siempre viene (cae al
   * `LoggingEmailSender` si falta `RESEND_API_KEY`).
   */
  emailSender?: EmailSender;
  webAppUrl?: string;
}): Hono {
  const app = new Hono();

  const listQuerySchema = z.object({
    estado: empresaStatusSchema.optional(),
  });

  const idParamSchema = z.object({ id: z.string().uuid() });
  const reemitirCodigoParamSchema = z.object({
    id: z.string().uuid(),
    membershipId: z.string().uuid(),
  });

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

    if (rows.length === 0) {
      return c.json({ empresas: [] });
    }

    const empresaIds = rows.map((r) => r.id);
    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const pendientes = await opts.db
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        empresaId: memberships.empresaId,
        nombre: users.fullName,
        rut: users.rut,
        email: users.email,
        rol: memberships.role,
        invitadoEn: memberships.invitedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.status, 'pendiente_invitacion'),
          inArray(memberships.empresaId, empresaIds),
        ),
      )
      .orderBy(memberships.invitedAt)
      // El listado trae a lo sumo 500 empresas; esta cota cubre sus pendientes.
      .limit(2000);

    const porEmpresa = new Map<string, typeof pendientes>();
    for (const row of pendientes) {
      if (row.empresaId === null) {
        continue;
      }
      const grupo = porEmpresa.get(row.empresaId) ?? [];
      grupo.push(row);
      porEmpresa.set(row.empresaId, grupo);
    }

    return c.json({
      empresas: rows.map((r) => {
        const ordenados = [...(porEmpresa.get(r.id) ?? [])].sort((a, b) => {
          const delta = fechaDe(a.invitadoEn).getTime() - fechaDe(b.invitadoEn).getTime();
          if (delta !== 0) {
            return delta;
          }
          return a.membershipId.localeCompare(b.membershipId);
        });
        const miembros = ordenados.map((row) => miembroPendienteDe(row));
        const dueno = miembros.find((m) => m.rol === 'dueno') ?? null;
        return {
          id: r.id,
          razon_social: r.razonSocial,
          rut: r.rut,
          estado: r.estado,
          es_transportista: r.esTransportista,
          es_generador_carga: r.esGeneradorCarga,
          miembros_pendientes: miembros,
          dueno_pendiente: dueno,
        };
      }),
    });
  });

  // POST /admin/empresas — ficha legal sin persona. Un generador de carga es
  // esta fila con `es_generador_carga`; un transportista, con el otro flag.
  // La credencial de quien entra se emite después, con el código de
  // activación. La empresa queda en verificación: matching exige `activa`.
  app.post('/', zValidator('json', crearEmpresaAdminSchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    const body = c.req.valid('json');

    return await withBusinessSpan(
      {
        name: 'alta.crear_empresa',
        attributes: {
          'alta.es_generador_carga': body.is_generador_carga,
          'alta.es_transportista': body.is_transportista,
          'alta.plan_slug': body.plan_slug,
        },
      },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('alta_empresa_admin_total').add(1, { resultado });
          setResultAttributes(span, { 'alta.resultado': resultado });
        };

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const planRows = await opts.db
          .select({ id: plans.id, isActive: plans.isActive })
          .from(plans)
          .where(eq(plans.slug, body.plan_slug))
          .limit(1);
        const plan = planRows[0];
        if (!plan || !plan.isActive) {
          record('invalid_plan');
          return c.json({ error: 'invalid_plan', code: 'invalid_plan' }, 400);
        }

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const duplicada = await opts.db
          .select({ id: empresas.id })
          .from(empresas)
          .where(eq(empresas.rut, body.rut))
          .limit(1);
        if (duplicada[0]) {
          record('rut_already_registered');
          return c.json({ error: 'conflict', code: 'rut_already_registered' }, 409);
        }

        try {
          const creada = await opts.db.transaction(async (tx) => {
            const inserted = await tx
              .insert(empresas)
              .values({
                legalName: body.legal_name,
                rut: body.rut,
                contactEmail: body.contact_email.toLowerCase(),
                contactPhone: body.contact_phone,
                addressStreet: body.address_street,
                addressCity: body.address_city,
                addressRegion: body.address_region,
                ...(body.address_postal_code
                  ? { addressPostalCode: body.address_postal_code }
                  : {}),
                isGeneradorCarga: body.is_generador_carga,
                isTransportista: body.is_transportista,
                isDemo: false,
                planId: plan.id,
                status: 'pendiente_verificacion',
                timezone: 'America/Santiago',
              })
              .returning({
                id: empresas.id,
                legalName: empresas.legalName,
                rut: empresas.rut,
                status: empresas.status,
                isGeneradorCarga: empresas.isGeneradorCarga,
                isTransportista: empresas.isTransportista,
              });
            const empresa = inserted[0];
            if (!empresa) {
              return null;
            }
            if (body.is_transportista) {
              const carrier = await tx
                .insert(carrierMemberships)
                .values({
                  empresaId: empresa.id,
                  tierSlug: 'free',
                  status: 'activa',
                })
                .returning({ id: carrierMemberships.id });
              if (!carrier[0]) {
                throw new Error('Insert carrier_memberships returned no row');
              }
            }
            return empresa;
          });

          if (!creada) {
            opts.logger.error({}, 'admin-empresas: insert empresa vacío');
            record('empresa_create_failed');
            return c.json({ error: 'internal_server_error', code: 'empresa_create_failed' }, 500);
          }

          opts.logger.info(
            {
              empresaId: creada.id,
              planSlug: body.plan_slug,
              isGeneradorCarga: creada.isGeneradorCarga,
              isTransportista: creada.isTransportista,
              invitedBy: admin.adminEmail,
            },
            'admin-empresas: ficha creada',
          );
          record('created');

          return c.json(
            {
              ok: true,
              empresa_id: creada.id,
              razon_social: creada.legalName,
              rut: creada.rut,
              estado: creada.status,
              es_generador_carga: creada.isGeneradorCarga,
              es_transportista: creada.isTransportista,
              plan_slug: body.plan_slug,
            },
            201,
          );
        } catch (err) {
          if (pgErrorCode(err) === '23505') {
            record('rut_already_registered');
            return c.json({ error: 'conflict', code: 'rut_already_registered' }, 409);
          }
          opts.logger.error(
            { err, errMessage: err instanceof Error ? err.message : String(err) },
            'admin-empresas: fallo al crear la ficha',
          );
          throw err;
        }
      },
    );
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
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            firebaseUid: users.firebaseUid,
            claveNumericaHash: users.claveNumericaHash,
            activationPinHash: users.activationPinHash,
          })
          .from(users)
          .where(eq(users.rut, body.rut))
          .limit(1);
        const existente = porRut[0];

        let userId: string;
        let vinculo: VinculoPersona;
        let codigoEmitido: string | null = null;
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
          userId = existente.id;
          vinculo = clasificarVinculoPersona(existente);
          if (vinculo === 'provisoria_sin_codigo') {
            const codigo = generateActivationPin();
            codigoEmitido = codigo;
            await opts.db
              .update(users)
              .set({ activationPinHash: hashActivationPin(codigo), updatedAt: new Date() })
              .where(eq(users.id, existente.id));
          }
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

          const codigo = generateActivationPin();
          codigoEmitido = codigo;
          vinculo = 'nueva';
          let inserted: { id: string }[];
          try {
            inserted = await opts.db
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
          } catch (err) {
            if (esRutDuplicado(err)) {
              record('rut_already_registered');
              return c.json({ error: 'conflict', code: 'rut_already_registered' }, 409);
            }
            throw err;
          }
          const created = inserted[0];
          if (!created) {
            opts.logger.error({ empresaId }, 'admin-empresa-miembros: insert user vacío');
            record('user_create_failed');
            return c.json({ error: 'internal_server_error', code: 'user_create_failed' }, 500);
          }
          userId = created.id;
        }

        const yaActiva = vinculo === 'cuenta_activa';
        const insertedMembership = await opts.db
          .insert(memberships)
          .values({
            userId,
            empresaId,
            role: body.rol,
            status: yaActiva ? 'activa' : 'pendiente_invitacion',
            invitedByUserId: admin.userContext.user.id,
            invitedAt: new Date(),
            joinedAt: yaActiva ? new Date() : null,
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

        if (codigoEmitido !== null && opts.emailSender) {
          // Persona provisoria: su correo registrado, no el que tipeó el admin.
          await enviarCorreoActivacionCuenta({
            sender: opts.emailSender,
            logger: opts.logger,
            email: existente?.email ?? email,
            nombre: existente?.fullName ?? body.full_name,
            rut: body.rut,
            codigo: codigoEmitido,
            empresa: empresa.razonSocial,
            rol: body.rol,
            webAppUrl: opts.webAppUrl ?? 'https://app.boosterchile.com',
          });
        }

        const expiraEn =
          codigoEmitido === null
            ? null
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        return c.json(
          {
            ok: true,
            user_id: userId,
            membership_id: membership.id,
            rol: body.rol,
            estado: yaActiva ? 'activa' : 'pendiente_invitacion',
            codigo_activacion: codigoEmitido,
            expira_en: expiraEn,
            vinculo,
          },
          201,
        );
      },
    );
  });

  // Reemite el código de una invitación que sigue pendiente. No recupera el
  // PIN anterior: genera otro, reemplaza el hash y reinicia `invitado_en`.
  // Sin body a propósito: un zValidator json rechazaría el POST vacío.
  app.post(
    '/:id/miembros/:membershipId/codigo',
    zValidator('param', reemitirCodigoParamSchema),
    async (c) => {
      const admin = requirePlatformAdmin(c);
      if (!admin.ok) {
        return admin.response;
      }

      const { id: empresaId, membershipId } = c.req.valid('param');

      return await withBusinessSpan(
        {
          name: 'alta.reemitir_codigo',
          attributes: { 'booster.empresa_id': empresaId },
        },
        async (span) => {
          const record = (resultado: string) => {
            getBusinessCounter('alta_reemision_codigo_total').add(1, { resultado });
            setResultAttributes(span, { 'alta.resultado': resultado });
          };

          // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
          const filas = await opts.db
            .select({
              membershipId: memberships.id,
              userId: memberships.userId,
              rol: memberships.role,
              estado: memberships.status,
              claveNumericaHash: users.claveNumericaHash,
              firebaseUid: users.firebaseUid,
              email: users.email,
              nombre: users.fullName,
              rut: users.rut,
              razonSocial: empresas.legalName,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .innerJoin(empresas, eq(empresas.id, memberships.empresaId))
            .where(and(eq(memberships.id, membershipId), eq(memberships.empresaId, empresaId)))
            .limit(1);
          const fila = filas[0];
          if (!fila) {
            record('membership_not_found');
            return c.json({ error: 'not_found', code: 'membership_not_found' }, 404);
          }

          const siguePendiente =
            fila.estado === 'pendiente_invitacion' &&
            fila.claveNumericaHash === null &&
            fila.firebaseUid.startsWith('pending-rut:');
          if (!siguePendiente) {
            record('already_activated');
            return c.json({ error: 'conflict', code: 'already_activated' }, 409);
          }

          const codigo = generateActivationPin();
          const ahora = new Date();
          const expiraEn = new Date(ahora.getTime() + SIETE_DIAS_MS);

          await opts.db.transaction(async (tx) => {
            // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
            await tx
              .update(users)
              .set({ activationPinHash: hashActivationPin(codigo), updatedAt: ahora })
              .where(eq(users.id, fila.userId));
            // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
            await tx
              .update(memberships)
              .set({ invitedAt: ahora, updatedAt: ahora })
              .where(eq(memberships.id, fila.membershipId));
          });

          opts.logger.info(
            {
              empresaId,
              userId: fila.userId,
              membershipId: fila.membershipId,
              rol: fila.rol,
              invitedBy: admin.adminEmail,
            },
            'admin-empresa-miembros: código reemitido (código no logueado)',
          );
          record('issued');

          if (opts.emailSender && fila.rut) {
            await enviarCorreoActivacionCuenta({
              sender: opts.emailSender,
              logger: opts.logger,
              email: fila.email,
              nombre: fila.nombre,
              rut: fila.rut,
              codigo,
              empresa: fila.razonSocial,
              rol: fila.rol,
              webAppUrl: opts.webAppUrl ?? 'https://app.boosterchile.com',
            });
          }

          return c.json(
            reemitirCodigoActivacionResponseSchema.parse({
              codigo_activacion: codigo,
              expira_en: expiraEn.toISOString(),
              membership_id: fila.membershipId,
              user_id: fila.userId,
              rol: fila.rol,
              estado: 'pendiente_invitacion',
            }),
            200,
          );
        },
      );
    },
  );

  return app;
}

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  if ('code' in err && typeof err.code === 'string') {
    return err.code;
  }
  if ('cause' in err) {
    return pgErrorCode(err.cause);
  }
  return undefined;
}
