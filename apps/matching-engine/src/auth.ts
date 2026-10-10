import type { Logger } from '@booster-ai/logger';
import { OAuth2Client } from 'google-auth-library';

export type VerificadorToken = (authorization: string | undefined) => Promise<{ ok: boolean }>;

/**
 * Verificación del ID token del llamador, en defensa en profundidad sobre
 * Cloud Run IAM (`roles/run.invoker`): firma contra Google JWKS, `aud` =
 * URL del servicio, `email` verificado = SA permitido. Mismo criterio que
 * `apps/api/src/middleware/auth.ts`.
 */
export function crearVerificadorToken(opts: {
  audience: string;
  allowedCallerSa: string;
  logger: Logger;
  oauthClient?: OAuth2Client;
}): VerificadorToken {
  const oauthClient = opts.oauthClient ?? new OAuth2Client();
  return async (authorization) => {
    if (!authorization?.startsWith('Bearer ')) {
      opts.logger.warn('ranking sin Bearer token');
      return { ok: false };
    }
    const idToken = authorization.slice('Bearer '.length).trim();
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken, audience: [opts.audience] });
      const payload = ticket.getPayload();
      if (payload?.email !== opts.allowedCallerSa || payload.email_verified !== true) {
        opts.logger.warn({ email: payload?.email }, 'ranking: caller no autorizado');
        return { ok: false };
      }
      return { ok: true };
    } catch (err) {
      opts.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'ranking: ID token inválido',
      );
      return { ok: false };
    }
  };
}
