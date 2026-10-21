import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { createPushTokenVerifier } from './push-auth.js';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

const SA = 'document-push-invoker@booster-ai-494222.iam.gserviceaccount.com';

function verifier(payload: Record<string, unknown> | undefined, fails = false) {
  const verifyIdToken = vi.fn(async () => {
    if (fails) {
      throw new Error('bad signature');
    }
    return { getPayload: () => payload };
  });
  return {
    verifyIdToken,
    verify: createPushTokenVerifier({
      allowedCallerSa: SA,
      logger,
      oauthClient: { verifyIdToken } as never,
    }),
  };
}

describe('createPushTokenVerifier', () => {
  it('acepta un token firmado por Google, del SA del push y con email verificado', async () => {
    const { verify, verifyIdToken } = verifier({ email: SA, email_verified: true });
    await expect(verify('Bearer tok')).resolves.toBe(true);
    // Sin `audience`: Cloud Run IAM ya exigió aud = URL del servicio.
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'tok' });
  });

  it('rechaza sin header o con un esquema distinto de Bearer', async () => {
    const { verify, verifyIdToken } = verifier({ email: SA, email_verified: true });
    await expect(verify(undefined)).resolves.toBe(false);
    await expect(verify('Basic abc')).resolves.toBe(false);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('rechaza firma inválida, otro SA, email sin verificar o token sin payload', async () => {
    await expect(verifier({ email: SA }, true).verify('Bearer tok')).resolves.toBe(false);
    await expect(
      verifier({
        email: 'github-deployer@booster-ai-494222.iam.gserviceaccount.com',
        email_verified: true,
      }).verify('Bearer tok'),
    ).resolves.toBe(false);
    await expect(verifier({ email: SA, email_verified: false }).verify('Bearer tok')).resolves.toBe(
      false,
    );
    await expect(verifier(undefined).verify('Bearer tok')).resolves.toBe(false);
  });
});
