import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { createPushTokenVerifier } from './push-auth.js';

const noop = (): void => undefined;
function makeLogger() {
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: vi.fn(),
    fatal: noop,
    child: () => logger,
  };
  return logger;
}

const AUD = 'https://booster-ai-document-service-1.southamerica-west1.run.app';
const SA = 'document-push-invoker@booster-ai-494222.iam.gserviceaccount.com';

function verifier(payload: Record<string, unknown> | undefined, fails = false) {
  const logger = makeLogger();
  const verifyIdToken = vi.fn(async () => {
    if (fails) {
      throw new Error('Wrong recipient, payload audience != requiredAudience');
    }
    return { getPayload: () => payload };
  });
  return {
    logger,
    verifyIdToken,
    verify: createPushTokenVerifier({
      audience: AUD,
      allowedCallerSa: SA,
      logger: logger as never as Logger,
      oauthClient: { verifyIdToken } as never,
    }),
  };
}

describe('createPushTokenVerifier', () => {
  it('acepta un token firmado por Google para la audience del push, del SA del push y con email verificado', async () => {
    const { verify, verifyIdToken } = verifier({ email: SA, email_verified: true });
    await expect(verify('Bearer tok')).resolves.toBe(true);
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'tok', audience: [AUD] });
  });

  it('rechaza sin header o con un esquema distinto de Bearer, sin llamar a Google', async () => {
    const { verify, verifyIdToken, logger } = verifier({ email: SA, email_verified: true });
    await expect(verify(undefined)).resolves.toBe(false);
    await expect(verify('Basic abc')).resolves.toBe(false);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('push document.uploaded sin Bearer token');
  });

  it('rechaza un token para otra audience o con firma inválida (verifyIdToken lanza)', async () => {
    const { verify, logger } = verifier({ email: SA, email_verified: true }, true);
    await expect(verify('Bearer tok')).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      { err: 'Wrong recipient, payload audience != requiredAudience' },
      'push document.uploaded: ID token inválido',
    );
  });

  it('rechaza otro SA y registra solo el dominio del emisor (el logger redacta emails)', async () => {
    const { verify, logger } = verifier({
      email: 'github-deployer@booster-ai-494222.iam.gserviceaccount.com',
      email_verified: true,
    });
    await expect(verify('Bearer tok')).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      { emailDomain: 'booster-ai-494222.iam.gserviceaccount.com', emailVerified: true },
      'push document.uploaded: emisor no autorizado',
    );
  });

  it('rechaza email sin verificar o token sin payload', async () => {
    await expect(verifier({ email: SA, email_verified: false }).verify('Bearer tok')).resolves.toBe(
      false,
    );
    const sinPayload = verifier(undefined);
    await expect(sinPayload.verify('Bearer tok')).resolves.toBe(false);
    expect(sinPayload.logger.error).toHaveBeenCalledWith(
      { emailDomain: null, emailVerified: null },
      'push document.uploaded: emisor no autorizado',
    );
  });
});
