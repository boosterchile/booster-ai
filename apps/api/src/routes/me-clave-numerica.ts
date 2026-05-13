import type { Logger } from '@booster-ai/logger';
import { rotarClaveSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';
import { hashClaveNumerica, verifyClaveNumerica } from '../services/clave-numerica.js';

/**
 * ADR-035 Wave 4 PR 3 — Endpoint para que el usuario setee o rote su
 * clave numérica de 6 dígitos. Subrouter de `/me`, requiere Firebase
 * Auth (id token válido) — el usuario ya está logueado por el flow
 * legacy email/password o Google.
 *
 *   POST /me/clave-numerica
 *     Body: { clave_anterior: string | null, clave_nueva: string }
 *
 *   Cases:
 *     - First-rotation (sin clave_numerica_hash setado en DB):
 *       `clave_anterior` debe ser `null`. El backend acepta y setea.
 *       Esto es lo que usan los usuarios legacy en su primer login
 *       después de Wave 4: entran con su método anterior, el frontend
 *       detecta `clave_numerica_hash == null` en /me, fuerza modal,
 *       el modal llama acá con `clave_anterior: null`.
 *
 *     - Rotation (con clave_numerica_hash ya setado):
 *       `clave_anterior` debe matchear el hash actual. Defensa contra
 *       session hijack: aunque el atacante tenga el Firebase token,
 *       no puede rotar la clave sin conocer la anterior.
 *
 *   Responses:
 *     - 204 No Content — clave seteada/rotada exitosamente.
 *     - 400 invalid_body — Zod validation falló.
 *     - 401 unauthorized — sin Firebase claims (middleware lo gatea).
 *     - 403 invalid_clave_anterior — clave_anterior no matchea hash actual.
 *     - 404 user_not_found — Firebase uid no matchea ningún row en
 *       `usuarios` (caso muy raro: sesión Firebase activa pero user
 *       eliminado de la DB).
 *
 * NO touches Firebase Auth — el password legacy email/password sigue
 * funcionando hasta que platform-admin lo deshabilite (Wave 4 PR 4
 * opcional, ~30 días post-deploy).
 */
export function createMeClaveNumericaRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.post('/clave-numerica', zValidator('json', rotarClaveSchema), async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      // El middleware debería haber filtrado, pero defensiva.
      return c.json({ error: 'unauthorized' }, 401);
    }
    const body = c.req.valid('json');

    // 1. Resolver user por firebase_uid.
    const rows = await opts.db
      .select({
        id: users.id,
        claveNumericaHash: users.claveNumericaHash,
      })
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = rows[0];

    if (!user) {
      opts.logger.warn(
        { firebase_uid: claims.uid, email: claims.email },
        'clave-numerica: user not found by firebase_uid',
      );
      return c.json({ error: 'user_not_found' }, 404);
    }

    // 2. Si ya tiene clave seteada, requerimos clave_anterior matcheable.
    //    Si no tiene clave, exigimos clave_anterior=null (first-rotation).
    if (user.claveNumericaHash) {
      if (body.clave_anterior === null) {
        opts.logger.info(
          { user_id: user.id },
          'clave-numerica: rotation rejected — clave_anterior null pero user tiene clave seteada',
        );
        return c.json({ error: 'invalid_clave_anterior' }, 403);
      }
      const matches = verifyClaveNumerica(body.clave_anterior, user.claveNumericaHash);
      if (!matches) {
        opts.logger.info(
          { user_id: user.id },
          'clave-numerica: rotation rejected — clave_anterior incorrecta',
        );
        return c.json({ error: 'invalid_clave_anterior' }, 403);
      }
    } else {
      // First-rotation. Aceptamos sin clave_anterior porque el usuario
      // está autenticado por Firebase legacy.
      if (body.clave_anterior !== null) {
        // Si el cliente pasa una clave_anterior pero no hay hash, NO la
        // verificamos — tratamos como first-rotation legítima (el
        // cliente puede estar siendo defensivo). Logueamos para auditoría.
        opts.logger.info(
          { user_id: user.id },
          'clave-numerica: first-rotation con clave_anterior — ignorada (no hash)',
        );
      }
    }

    // 3. Hashear y persistir.
    const nuevoHash = hashClaveNumerica(body.clave_nueva);
    await opts.db
      .update(users)
      .set({
        claveNumericaHash: nuevoHash,
        // Limpiar OTP de recovery pendiente si lo había (consumimos el
        // intent del usuario de actualizar su credencial).
        recoveryOtpHash: null,
        recoveryOtpExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));

    opts.logger.info(
      {
        user_id: user.id,
        event_type: user.claveNumericaHash ? 'clave_numerica.rotated' : 'clave_numerica.set',
      },
      'clave-numerica: success',
    );

    return c.body(null, 204);
  });

  return app;
}
