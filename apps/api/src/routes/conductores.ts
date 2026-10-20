import type { Logger } from '@booster-ai/logger';
import {
  MENSAJE_TELEFONO_CONDUCTOR,
  corregirEmailConductorBodySchema,
  createDriverBodySchema,
  esEmailDeRelleno,
  rutSchema,
  telefonoMovilConductorSchema,
  updateDriverBodySchema,
} from '@booster-ai/shared-schemas';
import type { WhatsAppContentSender } from '@booster-ai/whatsapp-client';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { esEmailDuplicado, pgErrorCode } from '../db/pg-error.js';
import { auditoriaEmailConductor, conductores, memberships, users } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { generateActivationPin, hashActivationPin } from '../services/activation-pin.js';
import {
  type AccionFirebaseConductor,
  type IdentidadFirebaseAuth,
  IdentidadFirebaseEnConflicto,
  reconciliarIdentidadFirebaseConductor,
} from '../services/identidad-firebase-conductor.js';
import { enviarCorreoActivacionConductor } from '../services/notifications/conductor-activacion-email.js';
import { enviarWhatsAppActivacionConductor } from '../services/notifications/conductor-activacion-whatsapp.js';
import type { EmailSender } from '../services/notifications/email-sender.js';
import { clasificarVinculoPersona, cuentaYaActivada } from '../services/vinculo-persona.js';
import { driverSyntheticEmail } from './auth-driver.js';

/**
 * Endpoints CRUD de conductores. Solo accesibles desde la interfaz del
 * carrier (rol `dueno|admin|despachador` de empresa transportista).
 *
 *   GET    /conductores         → lista de conductores de la empresa activa
 *   GET    /conductores/:id     → detalle (con datos del user enlazado)
 *   POST   /conductores         → crear (lookup-or-create user por RUT)
 *   PATCH  /conductores/:id          → actualizar licencia / status
 *   POST   /conductores/:id/telefono → WhatsApp y reenvío de invitación
 *   DELETE /conductores/:id          → soft delete (set eliminado_en)
 *
 * **Creación con lookup-or-create**:
 *   El carrier provee RUT del conductor. El backend:
 *   1. Normaliza el RUT.
 *   2. Busca user con ese RUT.
 *      - Si existe: busca la fila de conductor (UNIQUE usuario_id, también
 *        con soft delete).
 *        - Activo → 409 user_already_driver.
 *        - Retirado de otra empresa → 409 conductor_retirado_otra_empresa.
 *        - Retirado de esta empresa → reactiva esa fila (UPDATE). Si la
 *          identidad está compartida → 409 identidad_vinculada, sin escribir.
 *      - Si no existe: crea user "pendiente" con firebase_uid placeholder
 *        `pending-rut:<RUT>` (idempotente — mismo RUT → mismo placeholder).
 *   3. Inserta el conductor, o actualiza la fila retirada de esta empresa.
 *
 *   El placeholder firebase_uid se reemplaza cuando el conductor completa
 *   el flujo de login por RUT (D9). Hasta entonces el user no puede
 *   loguearse — el carrier ve al conductor en la lista pero el conductor
 *   no tiene acceso.
 */

const PENDING_FIREBASE_UID_PREFIX = 'pending-rut:';

function placeholderFirebaseUid(rut: string): string {
  return `${PENDING_FIREBASE_UID_PREFIX}${rut}`;
}

/**
 * Helpers defensivos para serializar Dates de Drizzle.
 *
 * `Date.toISOString()` lanza RangeError "Invalid time value" si el Date
 * tiene tiempo NaN — caso edge que ocurre cuando node-postgres parsea un
 * timestamp con formato inesperado (TZ awareness rara, etc.). Sin estos
 * helpers, una sola fila con un timestamp corrupto rompe el endpoint
 * completo con 500. Caso real detectado durante el dry-run pre-Corfo.
 */
function safeIsoString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

/**
 * Devuelve YYYY-MM-DD si el Date es válido. Null si es inválido o null.
 * Si viene como string, devuelve los primeros 10 chars.
 */
function safeDateString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) {
      return null;
    }
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return null;
}

async function emailOcupadoPorOtro(
  tx: Pick<Db, 'select'>,
  email: string,
  exceptoUserId: string | null,
): Promise<boolean> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  const row = rows[0];
  if (!row) {
    return false;
  }
  return row.id !== exceptoUserId;
}

/**
 * `usuarios.email` es global. Un despachador de esta empresa no puede
 * reescribirlo si la persona también pertenece a otra empresa, a una
 * organización stakeholder, o tiene aquí un rol distinto de conductor.
 * Una membresía ya removida no cuenta.
 */
async function emailIdentidadCompartida(
  db: Pick<Db, 'select'>,
  userId: string,
  empresaId: string,
): Promise<boolean> {
  const vinculos = await db
    .select({
      empresaId: memberships.empresaId,
      role: memberships.role,
      organizacionId: memberships.organizacionStakeholderId,
      status: memberships.status,
    })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)));
  return vinculos.some((vinculo) => {
    if (vinculo.status === 'removida') {
      return false;
    }
    if (vinculo.organizacionId != null) {
      return true;
    }
    if (vinculo.empresaId !== empresaId) {
      return true;
    }
    return vinculo.role !== 'conductor';
  });
}

/**
 * El alta no pisa un WhatsApp que la persona ya tenía. Solo completa el
 * dato cuando la fila llegó vacía (alta vieja o usuario creado sin número).
 */
function phoneSiEstaVacio(
  actual: string | null | undefined,
  incoming: string,
): { phone: string } | Record<string, never> {
  if (typeof actual === 'string' && actual.trim() !== '') {
    return {};
  }
  return { phone: incoming };
}

/** El alta no mueve un conductor que otra empresa ya retiró. */
const MENSAJE_CONDUCTOR_RETIRADO_OTRA_EMPRESA =
  'Este conductor fue retirado de otra empresa. No lo puedes reactivar desde aquí.';

const corregirTelefonoConductorBodySchema = z.object({
  phone: telefonoMovilConductorSchema,
});

export function createConductoresRoutes(opts: {
  db: Db;
  logger: Logger;
  /**
   * Envío del correo de activación al conductor. Opcional para no obligar a
   * cada test a construirlo; ausente ⇒ no se manda nada (el PIN sigue en la
   * respuesta, que es como funcionaba antes de agosto 2026).
   */
  emailSender?: EmailSender;
  webAppUrl?: string;
  /**
   * Admin SDK para alinear una cuenta Firebase creada con el email de
   * relleno. Ausente en tests que no ejercitan esa rama.
   */
  firebaseAuth?: IdentidadFirebaseAuth;
  /**
   * WhatsApp es el canal PRINCIPAL hacia el conductor (decisión del PO,
   * 2026-08-03): en la operación de carga chilena usan WhatsApp, no correo.
   * Ausente ⇒ no se intenta; el alta no depende de esto.
   */
  whatsappClient?: WhatsAppContentSender;
  activacionContentSid?: string;
}) {
  const app = new Hono();

  function requireAuth(c: Context) {
    const userContext = c.get('userContext');
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  function requireWriteRole(c: Context) {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth;
    }
    const role = auth.activeMembership.membership.role;
    if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'write_role_required' }, 403),
      };
    }
    return auth;
  }

  // ---------------------------------------------------------------------
  // GET / — lista de conductores activos (no eliminados) de la empresa.
  // ---------------------------------------------------------------------
  app.get('/', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const empresaId = auth.activeMembership.empresa.id;

    const rows = await opts.db
      .select({
        id: conductores.id,
        user_id: conductores.userId,
        empresa_id: conductores.empresaId,
        license_class: conductores.licenseClass,
        license_number: conductores.licenseNumber,
        license_expiry: conductores.licenseExpiry,
        is_extranjero: conductores.isExtranjero,
        status: conductores.driverStatus,
        created_at: conductores.createdAt,
        updated_at: conductores.updatedAt,
        deleted_at: conductores.deletedAt,
        user_full_name: users.fullName,
        user_rut: users.rut,
        user_email: users.email,
        user_phone: users.phone,
        user_firebase_uid: users.firebaseUid,
      })
      .from(conductores)
      .innerJoin(users, eq(conductores.userId, users.id))
      .where(and(eq(conductores.empresaId, empresaId), isNull(conductores.deletedAt)))
      .orderBy(asc(users.fullName));

    return c.json({
      conductores: rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        empresa_id: r.empresa_id,
        license_class: r.license_class,
        license_number: r.license_number,
        license_expiry: safeDateString(r.license_expiry),
        is_extranjero: r.is_extranjero,
        status: r.status,
        created_at: safeIsoString(r.created_at),
        updated_at: safeIsoString(r.updated_at),
        deleted_at: safeIsoString(r.deleted_at),
        user: {
          id: r.user_id,
          full_name: r.user_full_name,
          rut: r.user_rut,
          email: r.user_email,
          phone: r.user_phone,
          is_pending: r.user_firebase_uid.startsWith(PENDING_FIREBASE_UID_PREFIX),
        },
      })),
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id — detalle
  // ---------------------------------------------------------------------
  app.get('/:id', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [row] = await opts.db
      .select({
        id: conductores.id,
        user_id: conductores.userId,
        empresa_id: conductores.empresaId,
        license_class: conductores.licenseClass,
        license_number: conductores.licenseNumber,
        license_expiry: conductores.licenseExpiry,
        is_extranjero: conductores.isExtranjero,
        status: conductores.driverStatus,
        created_at: conductores.createdAt,
        updated_at: conductores.updatedAt,
        deleted_at: conductores.deletedAt,
        user_full_name: users.fullName,
        user_rut: users.rut,
        user_email: users.email,
        user_phone: users.phone,
        user_firebase_uid: users.firebaseUid,
      })
      .from(conductores)
      .innerJoin(users, eq(conductores.userId, users.id))
      .where(and(eq(conductores.id, id), eq(conductores.empresaId, empresaId)))
      .limit(1);

    if (!row) {
      return c.json({ error: 'conductor_not_found' }, 404);
    }

    return c.json({
      conductor: {
        id: row.id,
        user_id: row.user_id,
        empresa_id: row.empresa_id,
        license_class: row.license_class,
        license_number: row.license_number,
        license_expiry: safeDateString(row.license_expiry),
        is_extranjero: row.is_extranjero,
        status: row.status,
        created_at: safeIsoString(row.created_at),
        updated_at: safeIsoString(row.updated_at),
        deleted_at: safeIsoString(row.deleted_at),
        user: {
          id: row.user_id,
          full_name: row.user_full_name,
          rut: row.user_rut,
          email: row.user_email,
          phone: row.user_phone,
          is_pending: row.user_firebase_uid.startsWith(PENDING_FIREBASE_UID_PREFIX),
        },
      },
    });
  });

  // ---------------------------------------------------------------------
  // POST / — crear conductor (lookup-or-create user por RUT).
  // La reactivación de un retirado de esta empresa pasa por el mismo POST.
  // ---------------------------------------------------------------------
  const validarAltaConductor = zValidator('json', createDriverBodySchema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues;
      const soloTelefono = issues.length > 0 && issues.every((issue) => issue.path[0] === 'phone');
      if (soloTelefono) {
        return c.json({ error: 'telefono_invalido', message: MENSAJE_TELEFONO_CONDUCTOR }, 400);
      }
    }
    return undefined;
  });

  app.post('/', validarAltaConductor, async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    // Validar RUT con dígito verificador (rutSchema lo hace).
    const rutParsed = rutSchema.safeParse(body.rut);
    if (!rutParsed.success) {
      return c.json({ error: 'rut_invalido', code: 'rut_invalido' }, 400);
    }
    const rut = rutParsed.data;

    // D9/D10 — PIN de activación de 6 dígitos.
    //
    // Alta nueva: el PIN se genera si el user es nuevo o un placeholder sin
    // código (`provisoria_sin_codigo`). Una cuenta ya activada (dueño que
    // también se registra como conductor) no recibe PIN.
    //
    // Reactivación en la misma empresa: si la cuenta no está activa, el PIN
    // se regenera siempre — el anterior deja de servir — y el envío de
    // WhatsApp y correo es el de un alta normal.
    //
    // El plaintext del PIN NUNCA persiste; sólo se devuelve UNA vez en la
    // respuesta del POST para que el carrier lo muestre al conductor.
    let activationPin: string | null = null;

    try {
      const result = await opts.db.transaction(async (tx) => {
        // 1. Lookup user por RUT.
        const existingUsers = await tx
          .select({
            id: users.id,
            fullName: users.fullName,
            firebaseUid: users.firebaseUid,
            claveNumericaHash: users.claveNumericaHash,
            activationPinHash: users.activationPinHash,
            email: users.email,
            phone: users.phone,
          })
          .from(users)
          .where(eq(users.rut, rut))
          .limit(1);

        let userId: string;
        let reemplazoRelleno: {
          emailAnterior: string;
          accionFirebase: AccionFirebaseConductor;
        } | null = null;
        let reactivacion: { conductorId: string } | null = null;

        if (existingUsers.length > 0) {
          const existingUser = existingUsers[0];
          if (!existingUser) {
            throw new Error('Unexpected: empty user row after non-empty length check');
          }
          userId = existingUser.id;

          // rls-allowlist: chequeo global de unicidad user→conductor cross-empresa.
          // El UNIQUE de usuario_id incluye la fila retirada: reactivar es un
          // UPDATE, no un INSERT.
          const existingDriver = await tx
            .select({
              id: conductores.id,
              deletedAt: conductores.deletedAt,
              empresaId: conductores.empresaId,
            })
            .from(conductores)
            .where(eq(conductores.userId, userId))
            .limit(1);
          const filaExistente = existingDriver[0];
          if (filaExistente && filaExistente.deletedAt == null) {
            return { ok: false as const, code: 'user_already_driver' as const };
          }
          if (filaExistente && filaExistente.empresaId !== empresaId) {
            return {
              ok: false as const,
              code: 'conductor_retirado_otra_empresa' as const,
              message: MENSAJE_CONDUCTOR_RETIRADO_OTRA_EMPRESA,
            };
          }
          if (filaExistente) {
            if (await emailIdentidadCompartida(tx, userId, empresaId)) {
              return { ok: false as const, code: 'identidad_vinculada' as const };
            }
            reactivacion = { conductorId: filaExistente.id };
          }

          if (await emailOcupadoPorOtro(tx, body.email, userId)) {
            return { ok: false as const, code: 'email_already_registered' as const };
          }

          const cuentaActiva = cuentaYaActivada({
            firebaseUid: existingUser.firebaseUid,
            claveNumericaHash: existingUser.claveNumericaHash,
          });
          const pendiente = !cuentaActiva;
          const emailActual =
            typeof existingUser.email === 'string' ? existingUser.email.trim().toLowerCase() : '';
          const reemplazaRelleno =
            emailActual.length > 0 &&
            pendiente &&
            esEmailDeRelleno(emailActual) &&
            emailActual !== body.email;
          const telefono = reactivacion
            ? { phone: body.phone }
            : phoneSiEstaVacio(existingUser.phone, body.phone);

          if (reemplazaRelleno) {
            if (!reactivacion && (await emailIdentidadCompartida(tx, userId, empresaId))) {
              return { ok: false as const, code: 'identidad_vinculada' as const };
            }
            const accionFirebase = await reconciliarIdentidadFirebaseConductor({
              auth: opts.firebaseAuth ?? null,
              cuentaActiva: false,
              emailAnterior: emailActual,
              rut,
              syntheticEmail: driverSyntheticEmail(rut),
            });
            activationPin = generateActivationPin();
            await tx
              .update(users)
              .set({
                email: body.email,
                activationPinHash: hashActivationPin(activationPin),
                updatedAt: sql`now()`,
                ...telefono,
              })
              .where(eq(users.id, userId));
            reemplazoRelleno = { emailAnterior: emailActual, accionFirebase };
          } else if (reactivacion) {
            // En el alta normal un placeholder que ya tiene PIN no se reescribe.
            // Acá la cuenta pendiente siempre recibe uno nuevo: el anterior deja de servir.
            if (!cuentaActiva) {
              activationPin = generateActivationPin();
            }
            await tx
              .update(users)
              .set({
                ...(activationPin !== null
                  ? { activationPinHash: hashActivationPin(activationPin) }
                  : {}),
                phone: body.phone,
                updatedAt: sql`now()`,
              })
              .where(eq(users.id, userId));
          } else if (clasificarVinculoPersona(existingUser) === 'provisoria_sin_codigo') {
            // Solo el primer código. Una cuenta viva o un placeholder que ya
            // tiene pin no se reescribe: otra empresa no elige su clave.
            activationPin = generateActivationPin();
            await tx
              .update(users)
              .set({
                activationPinHash: hashActivationPin(activationPin),
                updatedAt: sql`now()`,
                ...phoneSiEstaVacio(existingUser.phone, body.phone),
              })
              .where(eq(users.id, userId));
          }
        } else {
          if (await emailOcupadoPorOtro(tx, body.email, null)) {
            return { ok: false as const, code: 'email_already_registered' as const };
          }
          // 2. Crear user "pending" con PIN de activación.
          activationPin = generateActivationPin();
          const insertedUsers = await tx
            .insert(users)
            .values({
              firebaseUid: placeholderFirebaseUid(rut),
              // Fase B: el email es obligatorio en el schema, así que acá
              // siempre es el real de la persona. Antes caía a un
              // `pending-rut-…@boosterchile.invalid` y creaba conductores
              // incontactables — 5 de 6 en producción terminaron así.
              email: body.email,
              fullName: body.full_name,
              phone: body.phone ?? null,
              rut,
              status: 'pendiente_verificacion',
              isPlatformAdmin: false,
              activationPinHash: hashActivationPin(activationPin),
            })
            .returning({ id: users.id });
          const newUser = insertedUsers[0];
          if (!newUser) {
            throw new Error('User insert returned no row');
          }
          userId = newUser.id;
        }

        // 3. Alta nueva, o reactivación de la fila retirada de esta empresa.
        // El INSERT chocaría con UNIQUE(usuario_id) si la fila sigue ahí.
        const filasConductor = reactivacion
          ? await tx
              .update(conductores)
              .set({
                licenseClass: body.license_class,
                licenseNumber: body.license_number,
                licenseExpiry: body.license_expiry,
                isExtranjero: body.is_extranjero,
                driverStatus: 'activo',
                deletedAt: null,
                updatedAt: sql`now()`,
              })
              .where(eq(conductores.id, reactivacion.conductorId))
              .returning()
          : await tx
              .insert(conductores)
              .values({
                userId,
                empresaId,
                licenseClass: body.license_class,
                licenseNumber: body.license_number,
                licenseExpiry: body.license_expiry,
                isExtranjero: body.is_extranjero,
                driverStatus: 'activo',
              })
              .returning();
        const newDriver = filasConductor[0];
        if (!newDriver) {
          throw new Error(
            reactivacion ? 'Conductor update returned no row' : 'Conductor insert returned no row',
          );
        }
        if (reemplazoRelleno) {
          const auditoria = await tx
            .insert(auditoriaEmailConductor)
            .values({
              conductorId: newDriver.id,
              usuarioId: userId,
              empresaId,
              actorUsuarioId: auth.userContext.user.id,
              emailAnterior: reemplazoRelleno.emailAnterior,
              emailNuevo: body.email,
              invitacionReenviada: activationPin !== null,
              accionFirebase: reemplazoRelleno.accionFirebase,
            })
            .returning({ id: auditoriaEmailConductor.id });
          if (!auditoria[0]) {
            throw new Error('auditoria_email_conductor_vacia');
          }
        }

        return {
          ok: true as const,
          driver: newDriver,
          userId,
          reactivado: reactivacion !== null,
        };
      });

      if (!result.ok) {
        return c.json(
          {
            error: result.code,
            code: result.code,
            ...('message' in result ? { message: result.message } : {}),
          },
          409,
        );
      }

      if (result.reactivado) {
        opts.logger.info(
          {
            conductorId: result.driver.id,
            userId: result.userId,
            empresaId,
          },
          'conductor retirado reactivado',
        );
      }

      // El conductor se entera por su propio correo, no por el WhatsApp de su
      // jefe. Va DESPUÉS de la transacción y sin `await` bloqueante del alta:
      // el registro ya está consumado y un proveedor caído no puede voltearlo.
      // WhatsApp primero: es el canal por el que el conductor efectivamente
      // mira. El correo va igual, como respaldo para quien sí lo usa.
      if (activationPin !== null) {
        await enviarWhatsAppActivacionConductor({
          client: opts.whatsappClient,
          contentSid: opts.activacionContentSid,
          logger: opts.logger,
          telefono: body.phone ?? null,
          nombre: body.full_name,
          rut: body.rut,
          empresa: auth.activeMembership.empresa.legalName ?? 'Tu empresa',
        });
      }

      if (opts.emailSender && activationPin !== null && body.email) {
        await enviarCorreoActivacionConductor({
          sender: opts.emailSender,
          logger: opts.logger,
          email: body.email,
          nombre: body.full_name,
          rut: body.rut,
          pin: activationPin,
          empresa: auth.activeMembership.empresa.legalName ?? 'Tu empresa',
          webAppUrl: opts.webAppUrl ?? 'https://app.boosterchile.com',
        });
      }

      return c.json(
        {
          conductor: {
            id: result.driver.id,
            user_id: result.driver.userId,
            empresa_id: result.driver.empresaId,
            license_class: result.driver.licenseClass,
            license_number: result.driver.licenseNumber,
            // `safeIsoString` en vez de `.toISOString()` directo: este último
            // lanza RangeError "Invalid time value" cuando node-postgres
            // devuelve la fecha en un formato que produce un Date con tiempo
            // NaN, y el 500 resultante se lleva puesto el alta entera. El
            // helper ya existía para el GET; el POST no lo usaba (detectado en
            // la prueba end-to-end de la Fase B).
            license_expiry: safeDateString(result.driver.licenseExpiry),
            is_extranjero: result.driver.isExtranjero,
            status: result.driver.driverStatus,
            created_at: result.driver.createdAt,
            updated_at: result.driver.updatedAt,
            deleted_at: result.driver.deletedAt,
          },
          /**
           * PIN de activación de 6 dígitos en plaintext. Se devuelve UNA
           * SOLA VEZ — el carrier debe mostrarlo al conductor inmediatamente
           * (botón "copiar" + recordatorio). No se puede recuperar después.
           * Si se pierde, se reenvía desde la ficha: el código anterior deja de servir.
           *
           * D10 — Undefined cuando el user ya estaba activado (e.g. dueño
           * que se agrega a sí mismo como conductor): el dueño ya tiene
           * email/password y no necesita PIN.
           */
          ...(activationPin !== null ? { activation_pin: activationPin } : {}),
          ...(result.reactivado ? { reactivado: true as const } : {}),
        },
        result.reactivado ? 200 : 201,
      );
    } catch (err) {
      if (err instanceof IdentidadFirebaseEnConflicto) {
        return c.json({ error: 'conflict', code: err.code }, 409);
      }
      // Captura específico de errores de unicidad de PG.
      const errCode = pgErrorCode(err);
      if (errCode === '23505') {
        const code = esEmailDuplicado(err) ? 'email_already_registered' : 'duplicate';
        return c.json({ error: code, code }, 409);
      }
      opts.logger.error(
        {
          err,
          // El serializador del logger colapsa el Error a `{}`: sin esto, un
          // 500 acá no deja rastro de su causa (visto en la prueba e2e).
          errMessage: err instanceof Error ? err.message : String(err),
          errCode,
        },
        'failed to create conductor',
      );
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // PATCH /:id — actualizar.
  // ---------------------------------------------------------------------
  app.patch('/:id', zValidator('json', updateDriverBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    // Verificar que el conductor pertenece a la empresa activa y no está
    // eliminado. Reusamos la query del detalle.
    const [existing] = await opts.db
      .select({ id: conductores.id, deletedAt: conductores.deletedAt })
      .from(conductores)
      .where(and(eq(conductores.id, id), eq(conductores.empresaId, empresaId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'conductor_not_found' }, 404);
    }
    if (existing.deletedAt != null) {
      return c.json({ error: 'conductor_deleted', code: 'conductor_deleted' }, 410);
    }

    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (body.license_class !== undefined) {
      updates.licenseClass = body.license_class;
    }
    if (body.license_number !== undefined) {
      updates.licenseNumber = body.license_number;
    }
    if (body.license_expiry !== undefined) {
      updates.licenseExpiry = body.license_expiry;
    }
    if (body.is_extranjero !== undefined) {
      updates.isExtranjero = body.is_extranjero;
    }
    if (body.status !== undefined) {
      updates.driverStatus = body.status;
    }

    const updated = await opts.db
      .update(conductores)
      .set(updates)
      .where(eq(conductores.id, id))
      .returning();
    const driver = updated[0];
    if (!driver) {
      return c.json({ error: 'conductor_not_found' }, 404);
    }

    return c.json({
      conductor: {
        id: driver.id,
        user_id: driver.userId,
        empresa_id: driver.empresaId,
        license_class: driver.licenseClass,
        license_number: driver.licenseNumber,
        license_expiry: safeDateString(driver.licenseExpiry),
        is_extranjero: driver.isExtranjero,
        status: driver.driverStatus,
        created_at: driver.createdAt,
        updated_at: driver.updatedAt,
        deleted_at: driver.deletedAt,
      },
    });
  });

  // ---------------------------------------------------------------------
  // POST /:id/email — email real + reenvío de invitación si sigue pendiente.
  // ---------------------------------------------------------------------
  app.post('/:id/email', zValidator('json', corregirEmailConductorBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    return await withBusinessSpan(
      {
        name: 'conductor.corregir_email',
        attributes: { 'booster.empresa_id': empresaId, 'booster.conductor_id': id },
      },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('conductor_email_corregido_total').add(1, { resultado });
          setResultAttributes(span, { 'conductor.email_resultado': resultado });
        };

        const encontrados = await opts.db
          .select({
            conductorId: conductores.id,
            deletedAt: conductores.deletedAt,
            userId: users.id,
            email: users.email,
            fullName: users.fullName,
            rut: users.rut,
            phone: users.phone,
            firebaseUid: users.firebaseUid,
            claveNumericaHash: users.claveNumericaHash,
          })
          .from(conductores)
          .innerJoin(users, eq(conductores.userId, users.id))
          .where(and(eq(conductores.id, id), eq(conductores.empresaId, empresaId)))
          .limit(1);
        const fila = encontrados[0];
        if (!fila) {
          record('not_found');
          return c.json({ error: 'conductor_not_found', code: 'conductor_not_found' }, 404);
        }
        if (fila.deletedAt != null) {
          record('deleted');
          return c.json({ error: 'conductor_deleted', code: 'conductor_deleted' }, 410);
        }

        if (await emailOcupadoPorOtro(opts.db, body.email, fila.userId)) {
          record('email_already_registered');
          return c.json({ error: 'conflict', code: 'email_already_registered' }, 409);
        }

        const cuentaActiva = cuentaYaActivada({
          firebaseUid: fila.firebaseUid,
          claveNumericaHash: fila.claveNumericaHash,
        });
        const emailAnterior = fila.email.trim().toLowerCase();
        const emailCambio = emailAnterior !== body.email;

        if (cuentaActiva && !emailCambio) {
          record('sin_cambio');
          return c.json({
            email: body.email,
            invitacion_reenviada: false,
            cuenta_activa: true,
          });
        }

        if (await emailIdentidadCompartida(opts.db, fila.userId, empresaId)) {
          record('identidad_vinculada');
          return c.json({ error: 'conflict', code: 'identidad_vinculada' }, 409);
        }

        let accionFirebase: AccionFirebaseConductor = 'omitida_cuenta_activa';
        if (!cuentaActiva) {
          try {
            accionFirebase = await reconciliarIdentidadFirebaseConductor({
              auth: opts.firebaseAuth ?? null,
              cuentaActiva: false,
              emailAnterior,
              rut: fila.rut,
              syntheticEmail: fila.rut ? driverSyntheticEmail(fila.rut) : emailAnterior,
            });
          } catch (err) {
            if (err instanceof IdentidadFirebaseEnConflicto) {
              record('identidad_firebase_en_conflicto');
              return c.json({ error: 'conflict', code: err.code }, 409);
            }
            opts.logger.error(
              {
                err,
                conductorId: id,
                errMessage: err instanceof Error ? err.message : String(err),
              },
              'reconciliar firebase del conductor falló',
            );
            record('firebase_error');
            return c.json({ error: 'firebase_error', code: 'firebase_error' }, 502);
          }
        }

        const activationPin = cuentaActiva ? null : generateActivationPin();
        const invitacionReenviada = activationPin !== null;

        try {
          await opts.db.transaction(async (tx) => {
            const actualizado = await tx
              .update(users)
              .set({
                email: body.email,
                ...(activationPin ? { activationPinHash: hashActivationPin(activationPin) } : {}),
                updatedAt: sql`now()`,
              })
              .where(eq(users.id, fila.userId))
              .returning({ id: users.id });
            if (!actualizado[0]) {
              throw new Error('update email conductor vacío');
            }
            const auditoria = await tx
              .insert(auditoriaEmailConductor)
              .values({
                conductorId: fila.conductorId,
                usuarioId: fila.userId,
                empresaId,
                actorUsuarioId: auth.userContext.user.id,
                emailAnterior,
                emailNuevo: body.email,
                invitacionReenviada,
                accionFirebase,
              })
              .returning({ id: auditoriaEmailConductor.id });
            if (!auditoria[0]) {
              throw new Error('auditoria_email_conductor_vacia');
            }
          });
        } catch (err) {
          if (pgErrorCode(err) === '23505') {
            if (esEmailDuplicado(err)) {
              record('email_already_registered');
              return c.json({ error: 'conflict', code: 'email_already_registered' }, 409);
            }
            record('duplicate');
            return c.json({ error: 'duplicate', code: 'duplicate' }, 409);
          }
          throw err;
        }

        if (activationPin !== null && fila.rut) {
          await enviarWhatsAppActivacionConductor({
            client: opts.whatsappClient,
            contentSid: opts.activacionContentSid,
            logger: opts.logger,
            telefono: fila.phone,
            nombre: fila.fullName,
            rut: fila.rut,
            empresa: auth.activeMembership.empresa.legalName ?? 'Tu empresa',
          });
          if (opts.emailSender) {
            await enviarCorreoActivacionConductor({
              sender: opts.emailSender,
              logger: opts.logger,
              email: body.email,
              nombre: fila.fullName,
              rut: fila.rut,
              pin: activationPin,
              empresa: auth.activeMembership.empresa.legalName ?? 'Tu empresa',
              webAppUrl: opts.webAppUrl ?? 'https://app.boosterchile.com',
            });
          }
        }

        opts.logger.info(
          {
            conductorId: id,
            usuarioId: fila.userId,
            actorId: auth.userContext.user.id,
            empresaId,
            invitacionReenviada,
            accionFirebase,
          },
          'email de conductor actualizado',
        );
        record(invitacionReenviada ? 'invitacion_reenviada' : 'contacto_actualizado');

        return c.json({
          email: body.email,
          invitacion_reenviada: invitacionReenviada,
          cuenta_activa: cuentaActiva,
          ...(activationPin !== null ? { activation_pin: activationPin } : {}),
        });
      },
    );
  });

  // ---------------------------------------------------------------------
  // POST /:id/telefono — WhatsApp + reenvío si el conductor sigue pendiente.
  // Separado de PATCH /:id: guardar el número puede regenerar el PIN.
  // ---------------------------------------------------------------------
  app.post(
    '/:id/telefono',
    zValidator('json', corregirTelefonoConductorBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'telefono_invalido', message: MENSAJE_TELEFONO_CONDUCTOR }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const auth = requireWriteRole(c);
      if (!auth.ok) {
        return auth.response;
      }
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const empresaId = auth.activeMembership.empresa.id;

      return await withBusinessSpan(
        {
          name: 'conductor.corregir_telefono',
          attributes: { 'booster.empresa_id': empresaId, 'booster.conductor_id': id },
        },
        async (span) => {
          const record = (resultado: string) => {
            getBusinessCounter('conductor_telefono_corregido_total').add(1, { resultado });
            setResultAttributes(span, { 'conductor.telefono_resultado': resultado });
          };

          const encontrados = await opts.db
            .select({
              conductorId: conductores.id,
              deletedAt: conductores.deletedAt,
              userId: users.id,
              email: users.email,
              fullName: users.fullName,
              rut: users.rut,
              phone: users.phone,
              firebaseUid: users.firebaseUid,
              claveNumericaHash: users.claveNumericaHash,
            })
            .from(conductores)
            .innerJoin(users, eq(conductores.userId, users.id))
            .where(and(eq(conductores.id, id), eq(conductores.empresaId, empresaId)))
            .limit(1);
          const fila = encontrados[0];
          if (!fila) {
            record('not_found');
            return c.json({ error: 'conductor_not_found', code: 'conductor_not_found' }, 404);
          }
          if (fila.deletedAt != null) {
            record('deleted');
            return c.json({ error: 'conductor_deleted', code: 'conductor_deleted' }, 410);
          }

          if (await emailIdentidadCompartida(opts.db, fila.userId, empresaId)) {
            record('identidad_vinculada');
            return c.json({ error: 'conflict', code: 'identidad_vinculada' }, 409);
          }

          const cuentaActiva = cuentaYaActivada({
            firebaseUid: fila.firebaseUid,
            claveNumericaHash: fila.claveNumericaHash,
          });
          const activationPin = cuentaActiva ? null : generateActivationPin();
          const invitacionReenviada = activationPin !== null;

          const actualizado = await opts.db
            .update(users)
            .set({
              phone: body.phone,
              ...(activationPin ? { activationPinHash: hashActivationPin(activationPin) } : {}),
              updatedAt: sql`now()`,
            })
            .where(eq(users.id, fila.userId))
            .returning({ id: users.id });
          if (!actualizado[0]) {
            throw new Error('update teléfono conductor vacío');
          }

          if (activationPin !== null && fila.rut) {
            await enviarWhatsAppActivacionConductor({
              client: opts.whatsappClient,
              contentSid: opts.activacionContentSid,
              logger: opts.logger,
              telefono: body.phone,
              nombre: fila.fullName,
              rut: fila.rut,
              empresa: auth.activeMembership.empresa.legalName ?? 'Tu empresa',
            });
          }

          opts.logger.info(
            {
              conductorId: id,
              usuarioId: fila.userId,
              actorId: auth.userContext.user.id,
              empresaId,
              invitacionReenviada,
            },
            'teléfono de conductor actualizado',
          );
          record(invitacionReenviada ? 'invitacion_reenviada' : 'contacto_actualizado');

          return c.json({
            phone: body.phone,
            email: fila.email,
            invitacion_reenviada: invitacionReenviada,
            cuenta_activa: cuentaActiva,
            ...(activationPin !== null ? { activation_pin: activationPin } : {}),
          });
        },
      );
    },
  );

  // ---------------------------------------------------------------------
  // DELETE /:id — soft delete.
  // ---------------------------------------------------------------------
  app.delete('/:id', async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const updated = await opts.db
      .update(conductores)
      .set({ deletedAt: sql`now()`, driverStatus: 'fuera_servicio', updatedAt: sql`now()` })
      .where(and(eq(conductores.id, id), eq(conductores.empresaId, empresaId)))
      .returning();
    const driver = updated[0];
    if (!driver) {
      return c.json({ error: 'conductor_not_found' }, 404);
    }
    return c.json({ ok: true, conductor_id: driver.id });
  });

  return app;
}

// Re-export para que el seed y D9 (login por RUT) puedan calcular el mismo
// placeholder cuando completen el firebase_uid real del conductor.
export { PENDING_FIREBASE_UID_PREFIX, placeholderFirebaseUid };
