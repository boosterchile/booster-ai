import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { solicitudesRegistro, users } from '../db/schema.js';

/**
 * Cuentas del proveedor de identidad que se encuentran por correo
 * (`.specs/correos-solicitudes-panel` SC5–SC7).
 *
 * Las dos reglas leen el estado al momento de usarlo: los proveedores de la
 * cuenta y las filas de `usuarios` y `solicitudes_registro`. No dependen de
 * una marca puesta al aprobar, así que valen también para las aprobaciones ya
 * hechas (SC7).
 */

/**
 * La cuenta tal como la devuelve `getUserByEmail`. Viene del proveedor, así que
 * se valida en el boundary: una forma que no se reconoce no se reutiliza.
 * `providerData` trae una entrada por cada credencial propia de la cuenta. El
 * proveedor informa `password` solo cuando hay contraseña o enlace por correo:
 * una cuenta creada sin contraseña llega con la lista vacía.
 */
const cuentaProveedorSchema = z.object({
  uid: z.string().min(1),
  providerData: z.array(z.object({ providerId: z.string() })),
});

export type MotivoCuentaNoReutilizable =
  | 'forma_desconocida'
  | 'con_proveedor_propio'
  | 'de_otra_cuenta'
  | 'de_una_solicitud';

export type ResultadoReutilizacion =
  | { reutilizable: true; uid: string }
  | { reutilizable: false; motivo: MotivoCuentaNoReutilizable };

/**
 * El uid es el `firebase_uid` de una solicitud de registro: la cuenta del
 * proveedor la creó una aprobación (SC6). La aprobación guarda ese uid solo en
 * el modo con enlace de onboarding; en el otro crea una fila de `usuarios` con
 * él.
 */
export async function cuentaCreadaPorSolicitud(
  db: Pick<Db, 'select'>,
  firebaseUid: string,
): Promise<boolean> {
  // rls-allowlist: el uid de una cuenta del proveedor es único en toda la plataforma.
  const filas = await db
    .select({ id: solicitudesRegistro.id })
    .from(solicitudesRegistro)
    .where(eq(solicitudesRegistro.firebaseUid, firebaseUid))
    .limit(1);
  return filas.length > 0;
}

/**
 * Una activación reutiliza la cuenta del proveedor que encontró por el correo
 * sintético del RUT solo en dos casos (SC5):
 *   - su uid ya es el `firebase_uid` de la fila que se activa (p. ej. otro
 *     pedido de la misma primera activación lo escribió primero, SC2);
 *   - está libre: ninguna fila de `usuarios` tiene su uid, no tiene proveedor
 *     propio y su uid no es el de una solicitud.
 *
 * A una cuenta libre se le revocan antes sus sesiones abiertas: así nadie que
 * la haya usado antes sigue dentro cuando la activación la deja en la fila.
 * Si la revocación falla, el error sube y el caller responde la falla del
 * proveedor sin escribir.
 */
export async function cuentaProveedorReutilizable(opts: {
  db: Pick<Db, 'select'>;
  auth: Pick<Auth, 'revokeRefreshTokens'>;
  cuenta: unknown;
  /** `usuarios.id` de la fila que se activa. */
  usuarioId: string;
}): Promise<ResultadoReutilizacion> {
  const leida = cuentaProveedorSchema.safeParse(opts.cuenta);
  if (!leida.success) {
    return { reutilizable: false, motivo: 'forma_desconocida' };
  }
  const { uid, providerData } = leida.data;
  // rls-allowlist: el uid de una cuenta del proveedor es único en toda la plataforma.
  const [duena] = await opts.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.firebaseUid, uid))
    .limit(1);
  if (duena) {
    return duena.id === opts.usuarioId
      ? { reutilizable: true, uid }
      : { reutilizable: false, motivo: 'de_otra_cuenta' };
  }
  if (providerData.length > 0) {
    return { reutilizable: false, motivo: 'con_proveedor_propio' };
  }
  if (await cuentaCreadaPorSolicitud(opts.db, uid)) {
    return { reutilizable: false, motivo: 'de_una_solicitud' };
  }
  await opts.auth.revokeRefreshTokens(uid);
  return { reutilizable: true, uid };
}
