import type { Logger } from '@booster-ai/logger';
import {
  createDriverBodySchema,
  rutSchema,
  updateDriverBodySchema,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { conductores, users } from '../db/schema.js';
import { generateActivationPin, hashActivationPin } from '../services/activation-pin.js';

/**
 * Endpoints CRUD de conductores. Solo accesibles desde la interfaz del
 * carrier (rol `dueno|admin|despachador` de empresa transportista).
 *
 *   GET    /conductores         → lista de conductores de la empresa activa
 *   GET    /conductores/:id     → detalle (con datos del user enlazado)
 *   POST   /conductores         → crear (lookup-or-create user por RUT)
 *   PATCH  /conductores/:id     → actualizar licencia / status
 *   DELETE /conductores/:id     → soft delete (set eliminado_en)
 *
 * **Creación con lookup-or-create**:
 *   El carrier provee RUT del conductor. El backend:
 *   1. Normaliza el RUT.
 *   2. Busca user con ese RUT.
 *      - Si existe: chequea que no haya conductor activo asociado (UNIQUE
 *        usuario_id). Si lo hay → 409 user_already_driver.
 *      - Si no existe: crea user "pendiente" con firebase_uid placeholder
 *        `pending-rut:<RUT>` (idempotente — mismo RUT → mismo placeholder).
 *   3. Inserta el conductor.
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

function placeholderEmail(rut: string): string {
  return `pending-rut-${rut.replace(/[.\-]/g, '')}@boosterchile.invalid`;
}

export function createConductoresRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireAuth(c: Context<any, any, any>) {
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

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireWriteRole(c: Context<any, any, any>) {
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
        license_expiry:
          r.license_expiry instanceof Date
            ? r.license_expiry.toISOString().slice(0, 10)
            : r.license_expiry,
        is_extranjero: r.is_extranjero,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        deleted_at: r.deleted_at,
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
        license_expiry:
          row.license_expiry instanceof Date
            ? row.license_expiry.toISOString().slice(0, 10)
            : row.license_expiry,
        is_extranjero: row.is_extranjero,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
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
  // ---------------------------------------------------------------------
  app.post('/', zValidator('json', createDriverBodySchema), async (c) => {
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

    // D9 — PIN de activación de 6 dígitos. Lo generamos antes de la
    // transacción para que el hash quede listo independiente del lookup-or-
    // create. El plaintext NUNCA persiste; sólo se devuelve UNA vez en la
    // respuesta del POST para que el carrier lo muestre al conductor.
    const activationPin = generateActivationPin();
    const activationPinHash = hashActivationPin(activationPin);

    try {
      const result = await opts.db.transaction(async (tx) => {
        // 1. Lookup user por RUT.
        const existingUsers = await tx
          .select({
            id: users.id,
            fullName: users.fullName,
            firebaseUid: users.firebaseUid,
          })
          .from(users)
          .where(eq(users.rut, rut))
          .limit(1);

        let userId: string;

        if (existingUsers.length > 0) {
          const existingUser = existingUsers[0];
          if (!existingUser) {
            throw new Error('Unexpected: empty user row after non-empty length check');
          }
          userId = existingUser.id;

          // Si ya hay conductor (no eliminado) para este user → conflicto.
          // Acotamos UNIQUE(usuario_id) en la BD a "no eliminados" via la
          // lógica de soft delete: chequeamos manualmente.
          const existingDriver = await tx
            .select({ id: conductores.id, deletedAt: conductores.deletedAt })
            .from(conductores)
            .where(eq(conductores.userId, userId))
            .limit(1);
          if (existingDriver.length > 0 && existingDriver[0]?.deletedAt == null) {
            return { ok: false as const, code: 'user_already_driver' };
          }

          // Si el user existente todavía no se ha activado (firebase_uid es
          // placeholder), seteamos el nuevo PIN de activación. Si ya está
          // activado (UID real, ej. el conductor también es despachador en
          // otra empresa con login completo), NO sobrescribimos su login.
          if (existingUser.firebaseUid.startsWith(PENDING_FIREBASE_UID_PREFIX)) {
            await tx
              .update(users)
              .set({ activationPinHash, updatedAt: sql`now()` })
              .where(eq(users.id, userId));
          }
        } else {
          // 2. Crear user "pending" con PIN de activación.
          const insertedUsers = await tx
            .insert(users)
            .values({
              firebaseUid: placeholderFirebaseUid(rut),
              email: body.email ?? placeholderEmail(rut),
              fullName: body.full_name,
              phone: body.phone ?? null,
              rut,
              status: 'pendiente_verificacion',
              isPlatformAdmin: false,
              activationPinHash,
            })
            .returning({ id: users.id });
          const newUser = insertedUsers[0];
          if (!newUser) {
            throw new Error('User insert returned no row');
          }
          userId = newUser.id;
        }

        // 3. Insertar conductor.
        const insertedDrivers = await tx
          .insert(conductores)
          .values({
            userId,
            empresaId,
            licenseClass: body.license_class,
            licenseNumber: body.license_number,
            licenseExpiry: new Date(`${body.license_expiry}T00:00:00.000Z`),
            isExtranjero: body.is_extranjero,
            driverStatus: 'activo',
          })
          .returning();
        const newDriver = insertedDrivers[0];
        if (!newDriver) {
          throw new Error('Conductor insert returned no row');
        }
        return { ok: true as const, driver: newDriver, userId };
      });

      if (!result.ok) {
        return c.json({ error: 'user_already_driver', code: result.code }, 409);
      }

      return c.json(
        {
          conductor: {
            id: result.driver.id,
            user_id: result.driver.userId,
            empresa_id: result.driver.empresaId,
            license_class: result.driver.licenseClass,
            license_number: result.driver.licenseNumber,
            license_expiry:
              result.driver.licenseExpiry instanceof Date
                ? result.driver.licenseExpiry.toISOString().slice(0, 10)
                : result.driver.licenseExpiry,
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
           * Si se pierde, hay que retirar al conductor y crearlo de nuevo.
           */
          activation_pin: activationPin,
        },
        201,
      );
    } catch (err) {
      // Captura específico de errores de unicidad de PG.
      const errCode = (err as { code?: string } | null)?.code;
      if (errCode === '23505') {
        return c.json({ error: 'duplicate', code: 'duplicate' }, 409);
      }
      opts.logger.error({ err }, 'failed to create conductor');
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
      updates.licenseExpiry = new Date(`${body.license_expiry}T00:00:00.000Z`);
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
        license_expiry:
          driver.licenseExpiry instanceof Date
            ? driver.licenseExpiry.toISOString().slice(0, 10)
            : driver.licenseExpiry,
        is_extranjero: driver.isExtranjero,
        status: driver.driverStatus,
        created_at: driver.createdAt,
        updated_at: driver.updatedAt,
        deleted_at: driver.deletedAt,
      },
    });
  });

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
export { PENDING_FIREBASE_UID_PREFIX, placeholderEmail, placeholderFirebaseUid };
