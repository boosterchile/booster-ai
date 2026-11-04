import type { Logger } from '@booster-ai/logger';
import { OAuth2Client } from 'google-auth-library';

/** `true` si el request viene del SA con el que Pub/Sub firma el push. */
export type PushTokenVerifier = (authorization: string | undefined) => Promise<boolean>;

/**
 * Verificación del OIDC que Pub/Sub adjunta a cada push (ADR-085), en defensa
 * en profundidad sobre Cloud Run IAM. El servicio es `public=false`: antes de
 * llegar acá, Cloud Run ya exigió un token válido, para una audience que el
 * servicio acepta, de un principal con `roles/run.invoker`.
 *
 * Esta capa revisa la firma contra las claves de Google, que `aud` sea
 * exactamente la audience del push y que el emisor sea el SA del push con email
 * verificado. Así no entra un principal con `run.invoker` heredado del proyecto
 * (owners, el deployer), ni un token del SA emitido para otro destino, aunque
 * alguien dejara el servicio público por error.
 *
 * Mismo criterio que `apps/matching-engine/src/auth.ts`.
 *
 * Los rechazos se registran como `error`: el único emisor legítimo es Pub/Sub,
 * así que un rechazo es configuración rota (o un intento), no ruido. Se registra
 * el dominio del email y no el email: el logger redacta los emails por valor.
 */
export function createPushTokenVerifier(opts: {
  audience: string;
  allowedCallerSa: string;
  logger: Logger;
  oauthClient?: Pick<OAuth2Client, 'verifyIdToken'>;
}): PushTokenVerifier {
  const oauthClient = opts.oauthClient ?? new OAuth2Client();
  return async (authorization) => {
    if (!authorization?.startsWith('Bearer ')) {
      opts.logger.error('push document.uploaded sin Bearer token');
      return false;
    }
    const idToken = authorization.slice('Bearer '.length).trim();
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken, audience: [opts.audience] });
      const payload = ticket.getPayload();
      if (payload?.email !== opts.allowedCallerSa || payload.email_verified !== true) {
        opts.logger.error(
          {
            emailDomain: payload?.email?.split('@')[1] ?? null,
            emailVerified: payload?.email_verified ?? null,
          },
          'push document.uploaded: emisor no autorizado',
        );
        return false;
      }
      return true;
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'push document.uploaded: ID token inválido',
      );
      return false;
    }
  };
}
