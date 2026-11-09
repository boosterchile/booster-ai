import { sql } from 'drizzle-orm';
import { correoEnListaRespaldo } from '../auth/acceso-plataforma.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

/**
 * El correo de una cuenta nueva (`.specs/correos-solicitudes-panel` SC1 y SC3).
 *
 * Un correo es el mismo con o sin mayúsculas. El UNIQUE de `usuarios.email`
 * sí las distingue, así que la búsqueda compara `lower(email) = lower($1)`.
 * Sin índice funcional: `usuarios` es chica y estas búsquedas corren solo en
 * las altas.
 */

/** Hay una cuenta con este correo, sin distinguir mayúsculas ni espacios. */
export async function existeCuentaConCorreo(
  db: Pick<Db, 'select'>,
  email: string,
): Promise<boolean> {
  // rls-allowlist: el correo de una cuenta es único en toda la plataforma.
  const filas = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email.trim().toLowerCase()})`)
    .limit(1);
  return filas.length > 0;
}

/**
 * El correo no puede quedar en una cuenta nueva: está en la lista de respaldo
 * del panel (`BOOSTER_PLATFORM_ADMIN_EMAILS`) o ya es de una cuenta. La lista
 * se revisa primero, sin consulta. Los dos casos reciben la misma respuesta
 * de un correo registrado, así que el caller no los distingue.
 */
export async function correoOcupado(opts: {
  db: Pick<Db, 'select'>;
  email: string;
  lista: readonly string[];
}): Promise<boolean> {
  if (correoEnListaRespaldo(opts.email, opts.lista)) {
    return true;
  }
  return await existeCuentaConCorreo(opts.db, opts.email);
}
