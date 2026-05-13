import type { Logger } from '@booster-ai/logger';
import { rutSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { conductores, memberships, users } from '../db/schema.js';
import { verifyActivationPin } from '../services/activation-pin.js';

const PENDING_FIREBASE_UID_PREFIX = 'pending-rut:';

/**
 * Genera el email sintético usado por los users-conductores en Firebase
 * email/password. RUT con puntos y guión → quita separadores y arma
 * `drivers+<rutSinSeparadores>@boosterchile.invalid`.
 *
 * Por qué `.invalid`: dominio reservado por RFC2606. Nunca rutea email
 * real, así que es seguro como identificador único de Firebase sin
 * exponer al driver una dirección que podría confundir.
 */
function driverSyntheticEmail(rut: string): string {
  return `drivers+${rut.replace(/[.\-]/g, '')}@boosterchile.invalid`;
}

/**
 * Endpoint `POST /auth/driver-activate` — primera activación de un
 * conductor por RUT + PIN.
 *
 * Flujo:
 *   1. Cliente (driver) ingresa RUT + PIN en /login/conductor (D9b).
 *   2. Backend:
 *      - Busca user por RUT.
 *      - Verifica que tenga activacion_pin_hash setado (sino → 410 ya
 *        activado, fall through a Firebase email/password login).
 *      - Verifica el PIN con scrypt timing-safe.
 *      - Crea (o actualiza) Firebase Auth user con email sintético +
 *        password = PIN. Si ya existe el Firebase user con ese email
 *        (e.g. retry del mismo activate), reusa.
 *      - UPDATE usuarios: firebase_uid=real, email=sintético,
 *        activacion_pin_hash=NULL, status='activo'.
 *      - Mint custom token para que el cliente haga signInWithCustomToken.
 *
 * Respuestas:
 *   - 200 { custom_token, synthetic_email } → cliente firma in.
 *   - 401 invalid_credentials → RUT o PIN no matchean (no distinguir
 *     cuál falló para no filtrar la existencia del RUT).
 *   - 410 already_activated → user ya tiene firebase_uid real. El cliente
 *     debe usar Firebase email/password con el email sintético.
 *   - 503 not_a_driver → user existe pero no tiene fila conductores activa.
 */
const activateBodySchema = z.object({
  rut: z.string().min(1),
  pin: z.string().regex(/^\d{6}$/, 'PIN debe ser 6 dígitos'),
});

export function createDriverAuthRoutes(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
}) {
  const app = new Hono();

  app.post('/driver-activate', zValidator('json', activateBodySchema), async (c) => {
    const body = c.req.valid('json');

    // Normalizar y validar RUT.
    const rutParsed = rutSchema.safeParse(body.rut);
    if (!rutParsed.success) {
      // No revelar formato — devolvemos invalid_credentials también para
      // RUT mal formado (evita oracle de RUT válidos).
      return c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);
    }
    const rut = rutParsed.data;

    // 1. Lookup user por RUT.
    const found = await opts.db
      .select({
        id: users.id,
        firebaseUid: users.firebaseUid,
        email: users.email,
        rut: users.rut,
        activationPinHash: users.activationPinHash,
      })
      .from(users)
      .where(eq(users.rut, rut))
      .limit(1);
    const user = found[0];

    if (!user) {
      // No revelar si el RUT existe o no.
      return c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);
    }

    // 2. Si ya está activado (firebase_uid real), no podemos activar de nuevo.
    if (!user.firebaseUid.startsWith(PENDING_FIREBASE_UID_PREFIX)) {
      return c.json(
        {
          error: 'already_activated',
          code: 'already_activated',
          synthetic_email: user.email,
        },
        410,
      );
    }

    // 3. Verificar PIN.
    if (!user.activationPinHash) {
      // Usuario placeholder pero sin PIN — caso raro (e.g. PIN expirado o
      // borrado manualmente). Tratar como invalid_credentials.
      return c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);
    }
    const pinOk = verifyActivationPin(body.pin, user.activationPinHash);
    if (!pinOk) {
      return c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);
    }

    // 4. Verificar que efectivamente sea conductor activo (sino no tiene
    // sentido activar — quizás el carrier lo retiró antes de que activara).
    // rls-allowlist: lookup user-scoped post-RUT+PIN, no hay empresa activa todavía
    const driverRows = await opts.db
      .select({ id: conductores.id, deletedAt: conductores.deletedAt })
      .from(conductores)
      .where(eq(conductores.userId, user.id))
      .limit(1);
    const driver = driverRows[0];
    if (!driver || driver.deletedAt != null) {
      return c.json({ error: 'not_a_driver', code: 'not_a_driver' }, 503);
    }

    // 5. Crear (o reusar) Firebase Auth user.
    const syntheticEmail = driverSyntheticEmail(rut);
    let firebaseUid: string;
    try {
      const existing = await opts.firebaseAuth.getUserByEmail(syntheticEmail).catch(() => null);
      if (existing) {
        // Caso retry (e.g. la primera vez el UPDATE de la DB falló post-Firebase).
        firebaseUid = existing.uid;
        // Reset del password al nuevo PIN — es un usuario fresco activando, y
        // si llegó hasta acá es porque pasó la verificación scrypt.
        await opts.firebaseAuth.updateUser(firebaseUid, { password: body.pin });
      } else {
        const created = await opts.firebaseAuth.createUser({
          email: syntheticEmail,
          emailVerified: false,
          password: body.pin,
          displayName: `Conductor ${rut}`,
          disabled: false,
        });
        firebaseUid = created.uid;
      }
    } catch (err) {
      opts.logger.error({ err, rut }, 'Firebase user create/update failed in driver-activate');
      return c.json({ error: 'firebase_error', code: 'firebase_error' }, 502);
    }

    // 6. UPDATE local DB.
    try {
      await opts.db
        .update(users)
        .set({
          firebaseUid,
          email: syntheticEmail,
          activationPinHash: null,
          status: 'activo',
          lastLoginAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, user.id));
    } catch (err) {
      // Si el UPDATE falla pero Firebase quedó creado, no rollback — el
      // próximo retry pasará por la rama getUserByEmail() y completará.
      opts.logger.error(
        { err, userId: user.id, rut },
        'DB update failed after Firebase user created',
      );
      return c.json({ error: 'db_error', code: 'db_error' }, 502);
    }

    // 6b. Promover membership de 'pendiente_invitacion' → 'activa' para
    //     todas las membresias de este user que sean rol=conductor.
    //     Invariante (migration 0029): todo conductor activo tiene una
    //     membership con role=conductor. Si no existe (caso edge: el
    //     conductor se creó antes de la migration o algo se desincronizó)
    //     la creamos acá usando el empresaId del driver row.
    try {
      const driverEmpresaRows = await opts.db
        .select({ empresaId: conductores.empresaId })
        .from(conductores)
        .where(eq(conductores.userId, user.id))
        .limit(1);
      const driverEmpresa = driverEmpresaRows[0];
      if (driverEmpresa) {
        const existingMembership = await opts.db
          .select({ id: memberships.id, status: memberships.status })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, user.id),
              eq(memberships.empresaId, driverEmpresa.empresaId),
            ),
          )
          .limit(1);
        const m = existingMembership[0];
        if (m) {
          // Promover a 'activa' si no lo está ya.
          if (m.status !== 'activa') {
            await opts.db
              .update(memberships)
              .set({
                status: 'activa',
                joinedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .where(eq(memberships.id, m.id));
          }
        } else {
          // Backfill seguro: insertar membership rol=conductor.
          await opts.db.insert(memberships).values({
            userId: user.id,
            empresaId: driverEmpresa.empresaId,
            role: 'conductor',
            status: 'activa',
            joinedAt: sql`now()`,
          });
        }
      }
    } catch (err) {
      // No-fatal: el flujo del conductor funciona aún sin membership
      // (driver-position resuelve via conductores.userId). Logueamos
      // warn y seguimos.
      opts.logger.warn(
        { err, userId: user.id, rut },
        'driver-activate: no se pudo promover/crear membership rol=conductor',
      );
    }

    // 7. Mint custom token para que el cliente haga signInWithCustomToken.
    let customToken: string;
    try {
      customToken = await opts.firebaseAuth.createCustomToken(firebaseUid, {
        booster_role_hint: 'conductor',
      });
    } catch (err) {
      opts.logger.error({ err, firebaseUid }, 'createCustomToken failed');
      return c.json({ error: 'firebase_error', code: 'firebase_error' }, 502);
    }

    opts.logger.info({ rut, firebaseUid }, 'Driver activated');

    return c.json({
      custom_token: customToken,
      synthetic_email: syntheticEmail,
    });
  });

  return app;
}

// Re-export para que el frontend y los tests puedan calcular el email
// sintético deterministically (e.g. al hacer signInWithEmailAndPassword
// en logins subsecuentes).
export { driverSyntheticEmail };
