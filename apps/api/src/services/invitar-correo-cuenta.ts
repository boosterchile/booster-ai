import type { Logger } from '@booster-ai/logger';
import {
  INVITACION_CORREO_CUENTA_TTL_MS,
  type TipoInvitacionCorreoCuenta,
} from '@booster-ai/shared-schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import type { Db } from '../db/client.js';
import { esEmailDuplicado, esRutDuplicado } from '../db/pg-error.js';
import { invitacionesCorreoCuenta, users } from '../db/schema.js';
import { existeCuentaConCorreo } from './correo-de-cuenta.js';
import {
  createInvitacionCorreoToken,
  hashInvitacionCorreoToken,
} from './invitar-correo-cuenta-token.js';
import type { EmailSender } from './notifications/email-sender.js';
import { enviarCorreoInvitacionCrearCuenta } from './notifications/invitar-correo-cuenta-email.js';

export type EmitirInvitacionError = 'email_already_registered';

export type EmitirInvitacionResult =
  | {
      ok: true;
      invitacionId: string;
      email: string;
      expiraEn: Date;
    }
  | { ok: false; code: EmitirInvitacionError };

/**
 * Emite invitación personal Booster (usuario nuevo). Reemplaza pendientes
 * previas del mismo correo. No crea fila en `usuarios` ni clave.
 */
export async function emitirInvitacionPersonalBooster(opts: {
  db: Db;
  logger: Logger;
  emailSender: EmailSender;
  webAppUrl: string;
  email: string;
  emitidoPorUsuarioId: string;
  now?: Date;
}): Promise<EmitirInvitacionResult> {
  const email = opts.email.trim().toLowerCase();
  if (await existeCuentaConCorreo(opts.db, email)) {
    return { ok: false, code: 'email_already_registered' };
  }

  const now = opts.now ?? new Date();
  const expiraEn = new Date(now.getTime() + INVITACION_CORREO_CUENTA_TTL_MS);
  const { token, tokenHash } = createInvitacionCorreoToken();

  const invitacionId = await opts.db.transaction(async (tx) => {
    await tx
      .delete(invitacionesCorreoCuenta)
      .where(
        and(
          eq(invitacionesCorreoCuenta.email, email),
          isNull(invitacionesCorreoCuenta.consumidoEn),
        ),
      );

    const inserted = await tx
      .insert(invitacionesCorreoCuenta)
      .values({
        email,
        tipo: 'personal_booster',
        tokenHash,
        expiraEn,
        emitidoPorUsuarioId: opts.emitidoPorUsuarioId,
        organizacionStakeholderId: null,
      })
      .returning({ id: invitacionesCorreoCuenta.id });

    const id = inserted[0]?.id;
    if (!id) {
      throw new Error('invitar-correo-cuenta: INSERT no devolvió id');
    }
    return id;
  });

  await enviarCorreoInvitacionCrearCuenta({
    sender: opts.emailSender,
    logger: opts.logger,
    invitacionId,
    email,
    tipo: 'personal_booster',
    token,
    webAppUrl: opts.webAppUrl,
    expiraEn,
  });

  opts.logger.info(
    {
      event_type: 'invitar_correo_cuenta.emitida',
      invitacion_id: invitacionId,
      tipo: 'personal_booster',
      actor_user_id: opts.emitidoPorUsuarioId,
    },
    'invitar-correo-cuenta: invitación emitida (token no logueado)',
  );

  return { ok: true, invitacionId, email, expiraEn };
}

export type ConsultarInvitacionResult =
  | {
      ok: true;
      email: string;
      tipo: TipoInvitacionCorreoCuenta;
      expiraEn: Date;
    }
  | { ok: false; code: 'invitacion_invalida' };

export async function consultarInvitacionPorToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<ConsultarInvitacionResult> {
  const tokenHash = hashInvitacionCorreoToken(token);
  const filas = await db
    .select({
      email: invitacionesCorreoCuenta.email,
      tipo: invitacionesCorreoCuenta.tipo,
      expiraEn: invitacionesCorreoCuenta.expiraEn,
      consumidoEn: invitacionesCorreoCuenta.consumidoEn,
    })
    .from(invitacionesCorreoCuenta)
    .where(eq(invitacionesCorreoCuenta.tokenHash, tokenHash))
    .limit(1);

  const fila = filas[0];
  if (!fila || fila.consumidoEn !== null || fila.expiraEn.getTime() <= now.getTime()) {
    return { ok: false, code: 'invitacion_invalida' };
  }
  if (fila.tipo !== 'personal_booster' && fila.tipo !== 'stakeholder') {
    return { ok: false, code: 'invitacion_invalida' };
  }
  return {
    ok: true,
    email: fila.email,
    tipo: fila.tipo,
    expiraEn: fila.expiraEn,
  };
}

export type CrearCuentaInvitacionError =
  | 'invitacion_invalida'
  | 'email_already_registered'
  | 'rut_already_registered';

export type CrearCuentaInvitacionServiceResult =
  | {
      ok: true;
      userId: string;
      email: string;
      tipo: TipoInvitacionCorreoCuenta;
      firebaseUid: string;
    }
  | { ok: false; code: CrearCuentaInvitacionError };

/**
 * Consume el token, crea usuario Firebase email/password y fila `usuarios`
 * activa con `es_admin_plataforma` si es personal Booster.
 */
export async function crearCuentaDesdeInvitacion(opts: {
  db: Db;
  logger: Logger;
  firebaseAuth: Auth;
  token: string;
  fullName: string;
  password: string;
  rut: string;
  now?: Date;
}): Promise<CrearCuentaInvitacionServiceResult> {
  const now = opts.now ?? new Date();
  const tokenHash = hashInvitacionCorreoToken(opts.token);

  const consulta = await consultarInvitacionPorToken(opts.db, opts.token, now);
  if (!consulta.ok) {
    return { ok: false, code: 'invitacion_invalida' };
  }

  if (await existeCuentaConCorreo(opts.db, consulta.email)) {
    return { ok: false, code: 'email_already_registered' };
  }

  const porRut = await opts.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.rut, opts.rut))
    .limit(1);
  if (porRut[0]) {
    return { ok: false, code: 'rut_already_registered' };
  }

  let firebaseUid: string;
  try {
    const created = await opts.firebaseAuth.createUser({
      email: consulta.email,
      password: opts.password,
      displayName: opts.fullName,
      emailVerified: true,
    });
    firebaseUid = created.uid;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code === 'auth/email-already-exists') {
      return { ok: false, code: 'email_already_registered' };
    }
    throw err;
  }

  try {
    const userId = await opts.db.transaction(async (tx) => {
      const consumed = await tx
        .update(invitacionesCorreoCuenta)
        .set({ consumidoEn: now })
        .where(
          and(
            eq(invitacionesCorreoCuenta.tokenHash, tokenHash),
            isNull(invitacionesCorreoCuenta.consumidoEn),
            sql`${invitacionesCorreoCuenta.expiraEn} > ${now}`,
          ),
        )
        .returning({
          id: invitacionesCorreoCuenta.id,
          tipo: invitacionesCorreoCuenta.tipo,
          email: invitacionesCorreoCuenta.email,
        });

      const inv = consumed[0];
      if (!inv) {
        throw new InvitacionConsumidaError();
      }

      const isPlatformAdmin = inv.tipo === 'personal_booster';
      const inserted = await tx
        .insert(users)
        .values({
          firebaseUid,
          email: inv.email,
          fullName: opts.fullName,
          rut: opts.rut,
          status: 'activo',
          isPlatformAdmin,
        })
        .returning({ id: users.id });

      const row = inserted[0];
      if (!row) {
        throw new Error('invitar-correo-cuenta: INSERT usuarios no devolvió id');
      }
      return row.id;
    });

    opts.logger.info(
      {
        event_type: 'invitar_correo_cuenta.cuenta_creada',
        user_id: userId,
        tipo: consulta.tipo,
      },
      'invitar-correo-cuenta: cuenta creada (sin secretos)',
    );

    return {
      ok: true,
      userId,
      email: consulta.email,
      tipo: consulta.tipo,
      firebaseUid,
    };
  } catch (err) {
    // Compensar Firebase si la DB falló tras createUser.
    try {
      await opts.firebaseAuth.deleteUser(firebaseUid);
    } catch (cleanupErr) {
      opts.logger.error(
        {
          firebase_uid: firebaseUid,
          error: cleanupErr instanceof Error ? cleanupErr.name : 'desconocido',
        },
        'invitar-correo-cuenta: no se pudo borrar usuario Firebase huérfano',
      );
    }

    if (err instanceof InvitacionConsumidaError) {
      return { ok: false, code: 'invitacion_invalida' };
    }
    if (esRutDuplicado(err)) {
      return { ok: false, code: 'rut_already_registered' };
    }
    if (esEmailDuplicado(err)) {
      return { ok: false, code: 'email_already_registered' };
    }
    throw err;
  }
}

class InvitacionConsumidaError extends Error {
  constructor() {
    super('invitacion_consumida');
    this.name = 'InvitacionConsumidaError';
  }
}
