import { esEmailDeRelleno } from '@booster-ai/shared-schemas';
import { sql } from 'drizzle-orm';
import { correoEnListaRespaldo } from '../auth/acceso-plataforma.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

/**
 * El correo de una cuenta nueva (`.specs/correos-solicitudes-panel` SC1 y SC3).
 *
 * Un correo es el mismo con o sin mayúsculas. El UNIQUE de `usuarios.email`
 * sí las distingue, así que la búsqueda compara `lower(email) = lower($1)`.
 * Sin índice funcional: `usuarios` es chica y la búsqueda corre solo en las
 * altas, una de ellas la solicitud pública, que tiene límite de frecuencia.
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
 * El correo no puede quedar en una cuenta nueva: ya es de una cuenta, está en
 * la lista de respaldo del panel (`BOOSTER_PLATFORM_ADMIN_EMAILS`) o es
 * reservado (`esEmailDeRelleno`: el dominio de las cuentas que se entran por
 * RUT y el relleno del alta vieja).
 *
 * La cuenta se busca en todos los casos y el resultado se combina después con
 * la lista y con los correos reservados: los tres motivos hacen la misma
 * consulta y reciben la misma respuesta de un correo registrado, así que el
 * caller no los distingue (spec §6.2).
 */
export async function correoOcupado(opts: {
  db: Pick<Db, 'select'>;
  email: string;
  lista: readonly string[];
}): Promise<boolean> {
  const deUnaCuenta = await existeCuentaConCorreo(opts.db, opts.email);
  return (
    deUnaCuenta || correoEnListaRespaldo(opts.email, opts.lista) || esEmailDeRelleno(opts.email)
  );
}
