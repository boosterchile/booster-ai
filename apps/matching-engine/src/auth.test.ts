import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { crearVerificadorToken } from './auth.js';

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

const AUD = 'https://booster-ai-matching-engine-1.southamerica-west1.run.app';
const SA = 'cloud-run-runtime@booster-ai-494222.iam.gserviceaccount.com';

function verificador(payload: Record<string, unknown> | undefined, falla = false) {
  const verifyIdToken = vi.fn(async () => {
    if (falla) {
      throw new Error('bad signature');
    }
    return { getPayload: () => payload };
  });
  return {
    verifyIdToken,
    verificar: crearVerificadorToken({
      audience: AUD,
      allowedCallerSa: SA,
      logger,
      oauthClient: { verifyIdToken } as never,
    }),
  };
}

describe('crearVerificadorToken', () => {
  it('acepta un token firmado para su audience, del SA permitido y con email verificado', async () => {
    const { verificar, verifyIdToken } = verificador({ email: SA, email_verified: true });
    await expect(verificar('Bearer tok')).resolves.toEqual({ ok: true });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'tok', audience: [AUD] });
  });

  it('rechaza sin header, firma inválida, otro SA, email no verificado o sin payload', async () => {
    expect(await verificador({ email: SA, email_verified: true }).verificar(undefined)).toEqual({
      ok: false,
    });
    expect(await verificador({ email: SA }, true).verificar('Bearer tok')).toEqual({ ok: false });
    expect(
      await verificador({
        email: 'otro@x.iam.gserviceaccount.com',
        email_verified: true,
      }).verificar('Bearer tok'),
    ).toEqual({ ok: false });
    expect(await verificador({ email: SA, email_verified: false }).verificar('Bearer tok')).toEqual(
      {
        ok: false,
      },
    );
    expect(await verificador(undefined).verificar('Bearer tok')).toEqual({ ok: false });
  });
});
