import { createHash, randomBytes } from 'node:crypto';

/**
 * Token opaco one-shot para la UI `/crear-cuenta` (ADR-093).
 *
 * No usa HMAC con secreto de firma: basta un nonce aleatorio + sha256 en DB
 * (mismo patrón que PINs de activación). El token en claro solo viaja en el
 * correo; en DB queda `token_hash`. Nunca loguear el token.
 */

const TOKEN_BYTES = 32;

export function hashInvitacionCorreoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createInvitacionCorreoToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashInvitacionCorreoToken(token) };
}
