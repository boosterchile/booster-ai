import type { Logger } from '@booster-ai/logger';
import { OAuth2Client } from 'google-auth-library';

/** `true` si el request viene del SA con el que Pub/Sub firma el push. */
export type PushTokenVerifier = (authorization: string | undefined) => Promise<boolean>;

/**
 * Verificación del OIDC que Pub/Sub adjunta a cada push (ADR-085), en defensa
 * en profundidad sobre Cloud Run IAM. El servicio es `public=false`: antes de
 * llegar acá, Cloud Run ya exigió un token válido, con `aud` = URL del servicio
 * y de un principal con `roles/run.invoker`.
 *
 * Esta capa revisa la firma contra las claves de Google y que el emisor sea
 * exactamente el SA del push con email verificado. Así un principal con
 * `run.invoker` heredado a nivel de proyecto (owners, el deployer) no puede
 * inyectar mensajes. `aud` no se repite acá: Terraform no puede pasarle al
 * servicio su propia URL (ciclo) y Cloud Run ya la exigió.
 *
 * Mismo criterio que `apps/matching-engine/src/auth.ts`.
 */
export function createPushTokenVerifier(opts: {
  allowedCallerSa: string;
  logger: Logger;
  oauthClient?: Pick<OAuth2Client, 'verifyIdToken'>;
}): PushTokenVerifier {
  const oauthClient = opts.oauthClient ?? new OAuth2Client();
  return async (authorization) => {
    if (!authorization?.startsWith('Bearer ')) {
      opts.logger.warn('push document.uploaded sin Bearer token');
      return false;
    }
    const idToken = authorization.slice('Bearer '.length).trim();
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken });
      const payload = ticket.getPayload();
      if (payload?.email !== opts.allowedCallerSa || payload.email_verified !== true) {
        opts.logger.warn({ email: payload?.email }, 'push document.uploaded: emisor no autorizado');
        return false;
      }
      return true;
    } catch (err) {
      opts.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'push document.uploaded: ID token inválido',
      );
      return false;
    }
  };
}
