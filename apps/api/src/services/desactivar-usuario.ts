import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Auth } from 'firebase-admin/auth';
import { users } from '../db/schema.js';

/**
 * Desactiva un usuario:
 *   1. Revoca todos sus refresh tokens en Firebase Auth (users con
 *      tokens activos pierden acceso ~1s después; cualquier verifyIdToken
 *      con `checkRevoked: true` rechaza el token con código
 *      `auth/id-token-revoked`).
 *   2. Marca `users.estado = 'suspendido' | 'eliminado'` en BD para
 *      que userContextMiddleware retorne 403 en cualquier path que dependa
 *      de la presencia del user.
 *
 * Operación idempotente: llamarla dos veces no rompe nada.
 *
 * Cierra el "Token revocation gap" identificado en ADR-028:
 * usuario removido en BD seguía con token Firebase válido hasta ~1h
 * post-acción. Con esta función + middleware actualizado: ~1s.
 */
export interface DesactivarUsuarioOpts {
  db: NodePgDatabase<Record<string, unknown>>;
  auth: Auth;
  logger: Logger;
  firebaseUid: string;
  /** 'suspendido' = bloqueable (audit/HR review). 'eliminado' = right-to-be-forgotten. */
  estado: 'suspendido' | 'eliminado';
  /** uid del actor que ejecuta la desactivación (para audit log). */
  actorFirebaseUid: string;
  /** Razón estructurada — útil para HR/audit reports. */
  razon: string;
}

export interface DesactivarUsuarioResult {
  /** True si se actualizó al menos una row en `users`. False si el user no existía. */
  actualizado: boolean;
  /** True si Firebase respondió OK al revoke. False si el user no existe en Firebase
   *  (ej. cuenta eliminada via consola pero pendiente en BD). */
  tokensRevocados: boolean;
}

export async function desactivarUsuario(
  opts: DesactivarUsuarioOpts,
): Promise<DesactivarUsuarioResult> {
  const { db, auth, logger, firebaseUid, estado, actorFirebaseUid, razon } = opts;

  // Step 1: revocar refresh tokens en Firebase. Hacerlo PRIMERO — si falla
  // el UPDATE BD después, el user todavía está revocado en Firebase.
  // El opuesto (UPDATE primero, revoke después) deja una ventana donde el
  // user está marcado inactivo en BD pero su token sigue validándose.
  let tokensRevocados = false;
  try {
    await auth.revokeRefreshTokens(firebaseUid);
    tokensRevocados = true;
  } catch (err) {
    // Firebase puede retornar `auth/user-not-found` si el user fue
    // eliminado en consola pero la row en `users` quedó huérfana. En
    // ese caso seguimos con el UPDATE para limpiar BD.
    const errMsg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/user-not-found') {
      logger.warn(
        { firebaseUid, actorFirebaseUid },
        'Firebase user not found — solo limpiamos row BD',
      );
    } else {
      // Cualquier otro error es bloqueante. NO updateamos BD si Firebase
      // falló por algo que no sea user-not-found.
      logger.error(
        { firebaseUid, actorFirebaseUid, err: errMsg, code },
        'Firebase revokeRefreshTokens falló — abortando desactivación',
      );
      throw err;
    }
  }

  // Step 2: UPDATE BD.
  const updated = await db
    .update(users)
    .set({ status: estado, updatedAt: new Date() })
    .where(eq(users.firebaseUid, firebaseUid))
    .returning({ id: users.id });

  const actualizado = updated.length > 0;

  logger.info(
    {
      firebaseUid,
      actorFirebaseUid,
      estado,
      razon,
      actualizado,
      tokensRevocados,
    },
    'usuario desactivado',
  );

  return { actualizado, tokensRevocados };
}
