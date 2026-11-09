import type { Logger } from '@booster-ai/logger';
import { activarCuentaSchema } from '@booster-ai/shared-schemas';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { Db } from '../db/client.js';
import { memberships, users } from '../db/schema.js';
import { zValidator } from '../lib/validation.js';
import { verifyActivationPin } from '../services/activation-pin.js';
import { hashClaveNumerica } from '../services/clave-numerica.js';
import {
  codigoPersonalVigente,
  cuentaYaActivada,
  invitacionesVigentes,
} from '../services/vinculo-persona.js';

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
 *
 * **Personal de Booster** (`.specs/alta-personal-booster`, SC6). Una cuenta
 * con `es_admin_plataforma = true` se activa solo con un código emitido desde
 * el panel y vigente según `activacion_vence_en`, también si tiene la
 * invitación original vigente: el panel es el único emisor que deja ese
 * vencimiento (`codigoPersonalVigente`). `/auth/driver-activate`, el otro
 * endpoint que consume el código, aplica la misma regla. La persona que el
 * platform-admin dio de alta desde el panel no tiene invitación a una
 * empresa: sin la invitación original vigente, además su correo tiene que
 * estar en la lista de Terraform (`BOOSTER_PLATFORM_ADMIN_EMAILS`), y se
 * activa sin tocar membresías. Si tiene la invitación original (su primera
 * membresía, pendiente y dentro de los 7 días), esa se activa igual que la de
 * cualquier persona. Si falta una condición, la respuesta es la misma.
 *
 * **Un solo uso también en paralelo.** La escritura exige que el código siga
 * siendo el que se verificó y que la cuenta no tenga clave. Si otra activación
 * o una re-emisión lo cambió en el intervalo, no escribe y responde lo mismo
 * que un código malo.
 */

/** Email sintético de Firebase — mismo formato que `auth-universal.ts`. */
function syntheticEmail(rut: string): string {
  return `users+${rut.replace(/[.\-]/g, '')}@boosterchile.invalid`;
}

export function createAuthActivarRoutes(opts: {
  db: Db;
  logger: Logger;
  firebaseAuth: Auth;
  /** `config.BOOSTER_PLATFORM_ADMIN_EMAILS`: la lista de Terraform. */
  platformAdminEmails: readonly string[];
  /**
   * Límite de intentos por RUT (`createRateLimitPinMiddleware` con cubos
   * propios en `server.ts`). Corre antes de validar y de leer la base, como
   * en `/auth/login-rut`.
   */
  rateLimitPerRut: MiddlewareHandler;
}): Hono {
  const app = new Hono();
  const listaPersonal = new Set(
    opts.platformAdminEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0),
  );

  app.post('/activar', opts.rateLimitPerRut, zValidator('json', activarCuentaSchema), async (c) => {
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
        claveNumericaHash: users.claveNumericaHash,
        fullName: users.fullName,
        email: users.email,
        isPlatformAdmin: users.isPlatformAdmin,
        activacionVenceEn: users.activacionVenceEn,
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
    const hashVerificado = user.activationPinHash;

    if (!verifyActivationPin(body.codigo, hashVerificado)) {
      opts.logger.info({ rut: body.rut }, 'auth-activar: código incorrecto');
      return rechazo();
    }

    // Misma respuesta que un código malo: no se reescribe la clave de una
    // cuenta que ya eligió la suya, aunque otra empresa haya dejado un hash.
    if (cuentaYaActivada(user)) {
      opts.logger.info({ userId: user.id }, 'auth-activar: cuenta ya viva, la clave no se toca');
      return rechazo();
    }

    // Una cuenta marcada como personal activa solo con el código del panel,
    // también si tiene invitaciones vigentes a empresas.
    if (user.isPlatformAdmin && !codigoPersonalVigente(user.activacionVenceEn)) {
      opts.logger.info(
        { userId: user.id },
        'auth-activar: cuenta del personal sin código vigente del panel',
      );
      return rechazo();
    }

    // En los flujos de empresa, el código se emite solo al crear a la persona,
    // junto con su primera membresía. El otro emisor es el panel del personal,
    // que también lo emite a una cuenta provisoria que ya existía (spec SC3).
    // Activar suma esa primera membresía si sigue pendiente y vigente, y
    // ninguna otra: las de otras empresas esperan a que la persona las acepte.
    // La invitación vence a los 7 días.
    // rls-allowlist: lookup pre-auth ligado al user recién verificado.
    const [primera] = await opts.db
      .select({
        id: memberships.id,
        empresaId: memberships.empresaId,
        invitedAt: memberships.invitedAt,
        status: memberships.status,
      })
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .orderBy(asc(memberships.createdAt), asc(memberships.id))
      .limit(1);
    const vigentes =
      primera?.status === 'pendiente_invitacion' ? invitacionesVigentes([primera]) : [];
    const invitacion = vigentes[0] ?? null;

    // Sin invitación vigente, el único otro camino es el personal de Booster
    // (el código del panel ya se comprobó arriba).
    const esPersonalBooster =
      invitacion === null && user.isPlatformAdmin && listaPersonal.has(user.email.toLowerCase());

    if (invitacion === null && !esPersonalBooster) {
      opts.logger.info({ rut: body.rut }, 'auth-activar: sin invitación vigente');
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

    const activada = await opts.db.transaction(async (tx) => {
      const escritas = await tx
        .update(users)
        .set({
          firebaseUid,
          // OJO: `email` NO se toca. Es el canal de comunicación de la
          // plataforma con la persona (spec §6.1).
          claveNumericaHash: hashClaveNumerica(body.clave_numerica),
          // El código es de un solo uso: se borran el hash y su vencimiento.
          activationPinHash: null,
          activacionVenceEn: null,
          status: 'activo',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.activationPinHash, hashVerificado),
            isNull(users.claveNumericaHash),
          ),
        )
        .returning({ id: users.id });
      if (escritas.length === 0) {
        return false;
      }

      // El personal de Booster sin invitación no tiene membresías que activar.
      if (vigentes.length > 0) {
        await tx
          .update(memberships)
          .set({ status: 'activa', joinedAt: new Date(), updatedAt: new Date() })
          .where(
            inArray(
              memberships.id,
              vigentes.map((row) => row.id),
            ),
          );
      }
      return true;
    });

    if (!activada) {
      // La cuenta Firebase creada arriba queda sin uso: el próximo intento la
      // encuentra por el email sintético y la reutiliza.
      opts.logger.info(
        { userId: user.id },
        'auth-activar: el código cambió antes de escribir; no se activa',
      );
      return rechazo();
    }

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

    if (invitacion) {
      opts.logger.info(
        { userId: user.id, empresaId: invitacion.empresaId, membershipId: invitacion.id },
        'auth-activar: cuenta activada con clave propia',
      );
    } else {
      opts.logger.info(
        { event_type: 'personal_booster.activacion', userId: user.id },
        'auth-activar: personal de Booster activado con clave propia',
      );
    }

    return c.json({ ok: true, activated: true, custom_token: customToken }, 200);
  });

  return app;
}
