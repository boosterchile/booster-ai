import type { Logger } from '@booster-ai/logger';
import { loginRutSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { verifyClaveNumerica } from '../services/clave-numerica.js';

const PENDING_FIREBASE_UID_PREFIX = 'pending-rut:';

/**
 * Email sintético determinístico para el flow universal RUT + clave
 * numérica (ADR-035). Mismo dominio `.invalid` reservado por RFC2606 que
 * usa `auth-driver.ts`, pero diferente prefijo para distinguir el flow.
 *
 * No rotamos al nuevo prefijo para usuarios ya migrados desde el flow
 * driver — esos siguen con `drivers+...@boosterchile.invalid` (Firebase
 * exige email único y rotar costaría migración).
 */
function universalSyntheticEmail(rut: string): string {
  return `users+${rut.replace(/[.\-]/g, '')}@boosterchile.invalid`;
}

/**
 * Endpoints de auth universal — ADR-035.
 *
 *   POST /auth/login-rut
 *     { rut, clave, tipo? } → { custom_token, synthetic_email, auth_method }
 *     - 401 invalid_credentials si RUT no existe o clave incorrecta.
 *     - 410 needs_rotation si user existe pero clave_numerica_hash es NULL
 *       (caso migración desde email/password — frontend pide al usuario
 *       setear su primera clave).
 *     - 502 firebase_error si createCustomToken falla.
 *
 * Diseño:
 *   - El selector de tipo de usuario (`tipo`) en el body NO afecta
 *     autorización. Solo se loguea para analytics. El rol viene de
 *     memberships del user (post-login el AppRoute redirige).
 *   - Email sintético determinístico: `users+<rut>@boosterchile.invalid`.
 *     Si el user ya tenía email real (legacy email/password), NO
 *     sobreescribimos esa columna; usamos el sintético solo internamente
 *     en Firebase Auth para el custom token. El email visible en /me
 *     sigue siendo el real (contacto del usuario).
 *
 * Auth method en custom claim:
 *   - El custom token incluye `auth_method: 'rut_clave'` para analytics
 *     y auditoría. Distingue logins universales de legacy email/password.
 */
export function createAuthUniversalRoutes(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
}) {
  const app = new Hono();

  app.post('/login-rut', zValidator('json', loginRutSchema), async (c) => {
    const body = c.req.valid('json');
    const rut = body.rut;
    const tipoHint = body.tipo ?? null;

    // 1. Lookup user por RUT.
    const found = await opts.db
      .select({
        id: users.id,
        firebaseUid: users.firebaseUid,
        email: users.email,
        rut: users.rut,
        claveNumericaHash: users.claveNumericaHash,
        status: users.status,
      })
      .from(users)
      .where(eq(users.rut, rut))
      .limit(1);
    const user = found[0];

    if (!user) {
      // No revelar si el RUT existe.
      return c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);
    }

    if (user.status === 'suspendido' || user.status === 'eliminado') {
      // Cuenta inactiva — mismo mensaje genérico para no enumerar.
      return c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);
    }

    // 2. Si no tiene clave_numerica_hash, está en estado pre-migración.
    //    Frontend debe redirigir a UI de "setear primera clave"
    //    autenticando con email/password legacy primero.
    if (!user.claveNumericaHash) {
      opts.logger.info(
        { rut, tipo_hint: tipoHint },
        'login-rut: user sin clave_numerica_hash → needs_rotation',
      );
      return c.json(
        {
          error: 'needs_rotation',
          code: 'needs_rotation',
          message:
            'Tu cuenta todavía no tiene una clave numérica. Inicia sesión una vez con tu método anterior para crearla.',
        },
        410,
      );
    }

    // 3. Verificar clave timing-safe.
    const claveOk = verifyClaveNumerica(body.clave, user.claveNumericaHash);
    if (!claveOk) {
      opts.logger.info({ rut, tipo_hint: tipoHint }, 'login-rut: clave incorrecta');
      return c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);
    }

    // 4. Determinar el firebase_uid a usar para el custom token.
    //
    //    Casos:
    //    - User ya tiene firebase_uid real (formato no pending-rut:): usar ese.
    //    - User es placeholder pending-rut:<rut> (caso legacy driver
    //      activation que migró su PIN como clave): necesitamos crear o
    //      reusar un Firebase user real antes de mint del custom token.
    let firebaseUid = user.firebaseUid;
    const syntheticEmail = universalSyntheticEmail(rut);

    if (firebaseUid.startsWith(PENDING_FIREBASE_UID_PREFIX)) {
      try {
        const existing = await opts.firebaseAuth.getUserByEmail(syntheticEmail).catch(() => null);
        if (existing) {
          firebaseUid = existing.uid;
        } else {
          const created = await opts.firebaseAuth.createUser({
            email: syntheticEmail,
            emailVerified: false,
            displayName: `Usuario ${rut}`,
            disabled: false,
          });
          firebaseUid = created.uid;
        }

        // UPDATE usuarios con el firebase_uid real + sintético email
        // (igual que driver-activate).
        await opts.db
          .update(users)
          .set({
            firebaseUid,
            email: syntheticEmail,
            status: 'activo',
            lastLoginAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(users.id, user.id));
      } catch (err) {
        opts.logger.error({ err, rut }, 'login-rut: error creando/promoviendo firebase user');
        return c.json({ error: 'firebase_error', code: 'firebase_error' }, 502);
      }
    } else {
      // Update last_login_at sin tocar firebase_uid ni email.
      await opts.db
        .update(users)
        .set({ lastLoginAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(users.id, user.id));
    }

    // 5. Mint custom token con auth_method custom claim para analytics.
    let customToken: string;
    try {
      customToken = await opts.firebaseAuth.createCustomToken(firebaseUid, {
        auth_method: 'rut_clave',
        booster_login_hint: tipoHint,
      });
    } catch (err) {
      opts.logger.error({ err, firebaseUid, rut }, 'login-rut: createCustomToken falló');
      return c.json({ error: 'firebase_error', code: 'firebase_error' }, 502);
    }

    opts.logger.info(
      { rut, firebaseUid, tipo_hint: tipoHint, auth_method: 'rut_clave' },
      'login-rut: éxito',
    );

    return c.json({
      custom_token: customToken,
      synthetic_email: syntheticEmail,
      auth_method: 'rut_clave' as const,
    });
  });

  return app;
}

// Re-export helper para tests y para que driver-activate lo reuse si
// queremos converger los dos sintéticos en una iteración futura.
export { universalSyntheticEmail };
