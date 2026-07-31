import type { Logger } from '@booster-ai/logger';
import { activarCuentaSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { memberships, users } from '../db/schema.js';
import { verifyActivationPin } from '../services/activation-pin.js';
import { hashClaveNumerica } from '../services/clave-numerica.js';

/**
 * equipo-de-la-empresa Fase A — `POST /auth/activar`.
 *
 * La persona que la empresa dio de alta prueba identidad con el código que le
 * entregaron y, **en el mismo acto, elige su clave**. Después entra siempre
 * por `POST /auth/login-rut` con RUT + esa clave (ADR-035).
 *
 * **El código no es una contraseña.** Sirve una vez, se borra al consumirlo y
 * nunca llega a Firebase como password. Esa es la diferencia con
 * `auth-driver.ts:151`, donde el PIN que genera el admin queda como credencial
 * permanente del conductor — o sea, su jefe conoce su contraseña.
 *
 * **El email real no se toca.** El sintético `users+<rut>@boosterchile.invalid`
 * existe solo como identificador interno de Firebase (mismo formato que
 * `auth-universal.ts`); la columna `usuarios.email` conserva el correo de la
 * persona, que es el canal de la plataforma con ella.
 *
 * **Sin oráculo**: RUT inexistente, código incorrecto, cuenta ya activada y
 * código vencido devuelven la MISMA respuesta. Un atacante no puede usar este
 * endpoint para enumerar RUTs ni para saber quién tiene una invitación viva.
 */

/** Vencimiento del código, contado desde la invitación (decisión del PO). */
const CODIGO_TTL_DIAS = 7;

/** Email sintético de Firebase — mismo formato que `auth-universal.ts`. */
function syntheticEmail(rut: string): string {
  return `users+${rut.replace(/[.\-]/g, '')}@boosterchile.invalid`;
}

export function createAuthActivarRoutes(opts: {
  db: Db;
  logger: Logger;
  firebaseAuth: Auth;
}): Hono {
  const app = new Hono();

  app.post('/activar', zValidator('json', activarCuentaSchema), async (c) => {
    const body = c.req.valid('json');

    /** Respuesta única para todos los rechazos (anti-enumeración). */
    const rechazo = () =>
      c.json({ error: 'invalid_credentials', code: 'invalid_credentials' }, 401);

    // rls-allowlist: lookup pre-auth por RUT; es el predicado del endpoint.
    const encontrados = await opts.db
      .select({
        id: users.id,
        rut: users.rut,
        firebaseUid: users.firebaseUid,
        activationPinHash: users.activationPinHash,
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.rut, body.rut))
      .limit(1);
    const user = encontrados[0];

    if (!user?.activationPinHash) {
      // No existe, o ya está activada. Misma respuesta para ambos.
      opts.logger.info({ rut: body.rut }, 'auth-activar: sin código pendiente');
      return rechazo();
    }

    if (!verifyActivationPin(body.codigo, user.activationPinHash)) {
      opts.logger.info({ rut: body.rut }, 'auth-activar: código incorrecto');
      return rechazo();
    }

    // La invitación pendiente da la referencia de vencimiento: el código vive
    // 7 días desde que la empresa dio de alta a la persona.
    // rls-allowlist: lookup pre-auth ligado al user recién verificado.
    const invitaciones = await opts.db
      .select({
        id: memberships.id,
        empresaId: memberships.empresaId,
        invitedAt: memberships.invitedAt,
      })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'pendiente_invitacion')))
      .limit(1);
    const invitacion = invitaciones[0];

    if (!invitacion) {
      opts.logger.info({ rut: body.rut }, 'auth-activar: sin invitación pendiente');
      return rechazo();
    }

    const vence = new Date(
      new Date(invitacion.invitedAt).getTime() + CODIGO_TTL_DIAS * 24 * 60 * 60 * 1000,
    );
    if (vence.getTime() < Date.now()) {
      opts.logger.info(
        { rut: body.rut, membershipId: invitacion.id },
        'auth-activar: código vencido',
      );
      return rechazo();
    }

    // Cuenta Firebase real. La contraseña NO se setea: la credencial de la
    // persona es su clave numérica, que verifica `login-rut` contra nuestra BD.
    let firebaseUid: string;
    try {
      const existente = await opts.firebaseAuth
        .getUserByEmail(syntheticEmail(body.rut))
        .catch(() => null);
      if (existente) {
        firebaseUid = existente.uid;
      } else {
        const creado = await opts.firebaseAuth.createUser({
          email: syntheticEmail(body.rut),
          emailVerified: false,
          displayName: user.fullName,
        });
        firebaseUid = creado.uid;
      }
    } catch (err) {
      opts.logger.error({ err, rut: body.rut }, 'auth-activar: Firebase createUser falló');
      return c.json({ error: 'service_unavailable', code: 'firebase_error' }, 503);
    }

    await opts.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          firebaseUid,
          // OJO: `email` NO se toca. Es el canal de comunicación de la
          // plataforma con la persona (spec §6.1).
          claveNumericaHash: hashClaveNumerica(body.clave_numerica),
          // El código es de un solo uso.
          activationPinHash: null,
          status: 'activo',
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      await tx
        .update(memberships)
        .set({ status: 'activa', joinedAt: new Date(), updatedAt: new Date() })
        .where(eq(memberships.id, invitacion.id));
    });

    let customToken: string;
    try {
      customToken = await opts.firebaseAuth.createCustomToken(firebaseUid, {
        auth_method: 'activacion',
      });
    } catch (err) {
      // La cuenta YA quedó activa: la persona puede entrar por login-rut con
      // la clave que acaba de elegir. No se pierde la activación.
      opts.logger.error(
        { err, userId: user.id },
        'auth-activar: createCustomToken falló; cuenta activa, entra por login-rut',
      );
      return c.json({ ok: true, activated: true }, 200);
    }

    opts.logger.info(
      { userId: user.id, empresaId: invitacion.empresaId, membershipId: invitacion.id },
      'auth-activar: cuenta activada con clave propia',
    );

    return c.json({ ok: true, activated: true, custom_token: customToken }, 200);
  });

  return app;
}
