import {
  CONFIRMACION_ACCESO_BOOSTER_MAX_INTENTOS,
  CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS,
} from '@booster-ai/shared-schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { tieneAccesoPlataforma } from '../auth/acceso-plataforma.js';
import type { Db } from '../db/client.js';
import { conductores, confirmacionesAccesoBooster, memberships, users } from '../db/schema.js';
import { generateActivationPin, hashActivationPin, verifyActivationPin } from './activation-pin.js';

/**
 * Confirmación del acceso al panel de Booster (`.specs/confirmar-acceso-booster`).
 *
 * Cuando el panel del personal da de alta una cuenta que ya tiene clave y
 * vínculos con una empresa, no la marca: emite un código de confirmación de 6
 * dígitos que el admin entrega en persona. La persona lo confirma desde su
 * sesión (`POST /me/confirmar-acceso-booster`) y recién ahí la cuenta queda con
 * `es_admin_plataforma = true`.
 *
 * - El código se guarda solo como hash (scrypt, mismo formato que el código de
 *   activación), vence a las 24 horas y deja de servir al quinto intento
 *   fallido. Nunca sale por correo ni WhatsApp, ni entra a logs, spans,
 *   métricas o auditoría.
 * - Una sola confirmación pendiente (`consumido_en` NULL) por persona: emitir
 *   una nueva borra la anterior en la misma transacción. Una consumida queda
 *   como registro.
 * - El código vale mientras quien lo emitió tenga acceso al panel
 *   (`tieneAccesoPlataforma`): si lo perdió, otro admin emite uno nuevo.
 * - Orden de bloqueo: primero la fila de `usuarios`, después la de la
 *   confirmación. El alta y la re-emisión bloquean la cuenta antes de emitir,
 *   «Quitar acceso» antes de borrar, y la confirmación bloquea las dos antes
 *   de verificar.
 */

/** Vigencia del código de confirmación. */
export const CONFIRMACION_TTL_MS = CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS * 60 * 60 * 1000;

type Lectura = Pick<Db, 'select'>;
type Escritura = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

/** La confirmación sin consumir de una persona. */
function pendienteDe(usuarioId: string) {
  return and(
    eq(confirmacionesAccesoBooster.usuarioId, usuarioId),
    isNull(confirmacionesAccesoBooster.consumidoEn),
  );
}

/**
 * Hash de un código al azar, calculado una vez al cargar el módulo. Sin
 * confirmación pendiente, el código se verifica igual contra él para que esa
 * respuesta tarde lo mismo que la de un código incorrecto; el resultado se
 * descarta.
 */
const HASH_DE_RELLENO = hashActivationPin(generateActivationPin());

/**
 * La cuenta tiene un vínculo con una empresa: una membresía con `empresa_id`
 * en cualquier estado (también removida) o una fila en `conductores` (también
 * retirada). Las membresías en organizaciones stakeholder no cuentan: solo las
 * crea el platform-admin.
 */
export async function tieneVinculoConEmpresa(tx: Lectura, usuarioId: string): Promise<boolean> {
  // rls-allowlist: alta del personal (platform-admin) — mira los vínculos de una cuenta en todas las empresas.
  const filas = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, usuarioId),
        sql`(exists (select 1 from ${memberships} where ${memberships.userId} = ${users.id} and ${memberships.empresaId} is not null) or exists (select 1 from ${conductores} where ${conductores.userId} = ${users.id}))`,
      ),
    )
    .limit(1);
  return filas.length > 0;
}

/** La persona tiene una confirmación pendiente (vigente, vencida o sin intentos). */
export async function tieneConfirmacionPendiente(tx: Lectura, usuarioId: string): Promise<boolean> {
  // rls-allowlist: panel del personal (platform-admin) — confirmación de una cuenta por su id.
  const filas = await tx
    .select({ id: confirmacionesAccesoBooster.id })
    .from(confirmacionesAccesoBooster)
    .where(pendienteDe(usuarioId))
    .limit(1);
  return filas.length > 0;
}

/**
 * Emite un código de confirmación nuevo para la persona. Borra la confirmación
 * pendiente anterior, si había, e inserta la nueva. Devuelve el código en
 * claro solo para la respuesta que lo entrega al admin.
 */
export async function emitirConfirmacionAccesoBooster(
  tx: Escritura,
  opts: { usuarioId: string; emitidoPorUsuarioId: string; ahora: Date },
): Promise<{ codigo: string; venceEn: Date }> {
  // rls-allowlist: panel del personal (platform-admin) — confirmación de una cuenta por su id.
  await tx.delete(confirmacionesAccesoBooster).where(pendienteDe(opts.usuarioId));
  const codigo = generateActivationPin();
  const venceEn = new Date(opts.ahora.getTime() + CONFIRMACION_TTL_MS);
  const insertadas = await tx
    .insert(confirmacionesAccesoBooster)
    .values({
      usuarioId: opts.usuarioId,
      codigoHash: hashActivationPin(codigo),
      venceEn,
      intentosFallidos: 0,
      emitidoPorUsuarioId: opts.emitidoPorUsuarioId,
    })
    .returning({ id: confirmacionesAccesoBooster.id });
  if (!insertadas[0]) {
    throw new Error('confirmacion-acceso-booster: el INSERT no devolvió fila');
  }
  return { codigo, venceEn };
}

/** Borra la confirmación pendiente de la persona. `true` si había una. */
export async function invalidarConfirmacionPendiente(
  tx: Escritura,
  usuarioId: string,
): Promise<boolean> {
  // rls-allowlist: panel del personal (platform-admin) — confirmación de una cuenta por su id.
  const borradas = await tx
    .delete(confirmacionesAccesoBooster)
    .where(pendienteDe(usuarioId))
    .returning({ id: confirmacionesAccesoBooster.id });
  return borradas.length > 0;
}

/** El código todavía puede confirmar: le quedan intentos y no venció. */
export function codigoConfirmacionUsable(
  confirmacion: { venceEn: Date | string; intentosFallidos: number },
  ahora = Date.now(),
): boolean {
  return (
    confirmacion.intentosFallidos < CONFIRMACION_ACCESO_BOOSTER_MAX_INTENTOS &&
    new Date(confirmacion.venceEn).getTime() >= ahora
  );
}

/** Motivo interno de un rechazo. La respuesta HTTP es la misma para todos. */
export type MotivoRechazoConfirmacion =
  | 'sin_codigo'
  | 'cuenta_no_activa'
  | 'emisor_sin_acceso'
  | 'incorrecto'
  | 'vencido'
  | 'agotado';

export type ResultadoConfirmacion =
  | {
      tipo: 'rechazada';
      motivo: MotivoRechazoConfirmacion;
      /** Intentos fallidos tras este intento; null sin confirmación pendiente. */
      intentosFallidos: number | null;
    }
  | {
      tipo: 'confirmada';
      persona: { id: string; email: string; fullName: string };
      emitidoPorUsuarioId: string;
      /** Correo de quien emitió el código, en minúsculas, leído en la misma transacción. */
      emitidoPorEmail: string;
      /** La cuenta ya estaba marcada antes de confirmar. */
      yaMarcada: boolean;
    };

/**
 * Confirma el acceso de la persona con el código que le entregó el admin.
 * Corre dentro de una transacción: bloquea la cuenta y su confirmación
 * pendiente hasta el commit, así que intentos en paralelo se cuentan todos y
 * un código se consume una sola vez.
 *
 * - Sin confirmación pendiente: verifica contra el hash de relleno y no
 *   escribe.
 * - Cuenta que no está `activo`: no escribe; la confirmación sigue pendiente.
 * - Sin intentos o vencida: no escribe.
 * - Quien emitió el código ya no tiene acceso al panel: no escribe ni suma
 *   un intento; la confirmación sigue pendiente hasta que otro admin emita
 *   un código nuevo.
 * - Código incorrecto: suma un intento fallido.
 * - Código correcto: consume la confirmación y marca la cuenta.
 */
export async function confirmarAccesoBooster(
  tx: Escritura,
  opts: {
    usuarioId: string;
    codigo: string;
    ahora: Date;
    /** `config.BOOSTER_PLATFORM_ADMIN_EMAILS`: la lista de respaldo del panel. */
    platformAdminEmails: readonly string[];
  },
): Promise<ResultadoConfirmacion> {
  const cuentas = await tx
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isPlatformAdmin: users.isPlatformAdmin,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, opts.usuarioId))
    .for('update')
    .limit(1);
  const cuenta = cuentas[0];

  const pendientes = cuenta
    ? // rls-allowlist: la persona confirma su propia cuenta; el id sale de su sesión.
      await tx
        .select({
          id: confirmacionesAccesoBooster.id,
          codigoHash: confirmacionesAccesoBooster.codigoHash,
          venceEn: confirmacionesAccesoBooster.venceEn,
          intentosFallidos: confirmacionesAccesoBooster.intentosFallidos,
          emitidoPorUsuarioId: confirmacionesAccesoBooster.emitidoPorUsuarioId,
        })
        .from(confirmacionesAccesoBooster)
        .where(pendienteDe(cuenta.id))
        .for('update')
        .limit(1)
    : [];
  const pendiente = pendientes[0];

  // El scrypt corre siempre, haya o no confirmación pendiente.
  const coincide = verifyActivationPin(opts.codigo, pendiente?.codigoHash ?? HASH_DE_RELLENO);

  if (!cuenta || !pendiente) {
    return { tipo: 'rechazada', motivo: 'sin_codigo', intentosFallidos: null };
  }
  if (cuenta.status !== 'activo') {
    return {
      tipo: 'rechazada',
      motivo: 'cuenta_no_activa',
      intentosFallidos: pendiente.intentosFallidos,
    };
  }
  if (pendiente.intentosFallidos >= CONFIRMACION_ACCESO_BOOSTER_MAX_INTENTOS) {
    return { tipo: 'rechazada', motivo: 'agotado', intentosFallidos: pendiente.intentosFallidos };
  }
  if (!codigoConfirmacionUsable(pendiente, opts.ahora.getTime())) {
    return { tipo: 'rechazada', motivo: 'vencido', intentosFallidos: pendiente.intentosFallidos };
  }

  // Quien emitió el código, en la misma transacción: el evento y el aviso
  // usan su correo, y el código solo vale mientras tenga acceso al panel.
  // rls-allowlist: cuenta de quien emitió el código, por su id, para la regla única de acceso.
  const emisores = await tx
    .select({ email: users.email, isPlatformAdmin: users.isPlatformAdmin, status: users.status })
    .from(users)
    .where(eq(users.id, pendiente.emitidoPorUsuarioId))
    .limit(1);
  const emisor = emisores[0];
  if (!emisor || !tieneAccesoPlataforma(emisor, opts.platformAdminEmails)) {
    return {
      tipo: 'rechazada',
      motivo: 'emisor_sin_acceso',
      intentosFallidos: pendiente.intentosFallidos,
    };
  }

  if (!coincide) {
    // rls-allowlist: la persona confirma su propia cuenta; la fila es su confirmación bloqueada.
    await tx
      .update(confirmacionesAccesoBooster)
      .set({ intentosFallidos: sql`${confirmacionesAccesoBooster.intentosFallidos} + 1` })
      .where(eq(confirmacionesAccesoBooster.id, pendiente.id));
    return {
      tipo: 'rechazada',
      motivo: 'incorrecto',
      intentosFallidos: pendiente.intentosFallidos + 1,
    };
  }

  // rls-allowlist: la persona confirma su propia cuenta; la fila es su confirmación bloqueada.
  const consumidas = await tx
    .update(confirmacionesAccesoBooster)
    .set({ consumidoEn: opts.ahora })
    .where(
      and(
        eq(confirmacionesAccesoBooster.id, pendiente.id),
        isNull(confirmacionesAccesoBooster.consumidoEn),
      ),
    )
    .returning({ id: confirmacionesAccesoBooster.id });
  if (consumidas.length === 0) {
    return { tipo: 'rechazada', motivo: 'sin_codigo', intentosFallidos: null };
  }
  await tx
    .update(users)
    .set({ isPlatformAdmin: true, updatedAt: opts.ahora })
    .where(eq(users.id, cuenta.id));

  return {
    tipo: 'confirmada',
    persona: { id: cuenta.id, email: cuenta.email, fullName: cuenta.fullName },
    emitidoPorUsuarioId: pendiente.emitidoPorUsuarioId,
    emitidoPorEmail: emisor.email.toLowerCase(),
    yaMarcada: cuenta.isPlatformAdmin === true,
  };
}
