import { and, eq, ne } from 'drizzle-orm';
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
 *   - su uid ya es el `firebase_uid` de la cuenta que se activa;
 *   - está libre: sin proveedor propio, su uid no es el de otra fila de
 *     `usuarios` y no es el de una solicitud.
 */
export async function cuentaProveedorReutilizable(opts: {
  db: Pick<Db, 'select'>;
  cuenta: unknown;
  usuario: { id: string; firebaseUid: string };
}): Promise<ResultadoReutilizacion> {
  const leida = cuentaProveedorSchema.safeParse(opts.cuenta);
  if (!leida.success) {
    return { reutilizable: false, motivo: 'forma_desconocida' };
  }
  const { uid, providerData } = leida.data;
  if (uid === opts.usuario.firebaseUid) {
    return { reutilizable: true, uid };
  }
  if (providerData.length > 0) {
    return { reutilizable: false, motivo: 'con_proveedor_propio' };
  }
  // rls-allowlist: el uid de una cuenta del proveedor es único en toda la plataforma.
  const deOtraCuenta = await opts.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.firebaseUid, uid), ne(users.id, opts.usuario.id)))
    .limit(1);
  if (deOtraCuenta.length > 0) {
    return { reutilizable: false, motivo: 'de_otra_cuenta' };
  }
  if (await cuentaCreadaPorSolicitud(opts.db, uid)) {
    return { reutilizable: false, motivo: 'de_una_solicitud' };
  }
  return { reutilizable: true, uid };
}
