import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));
vi.mock('./logger.js', () => ({ logger: { error: errorMock } }));

describe('env', () => {
  // `afterEach` quita todos los stubs, incluidos los de test/setup.ts, así que
  // cada test parte de la configuración válida de base. Sin esto el resultado
  // depende de que exista un `.env` local: CI no lo tiene.
  beforeEach(() => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'booster-ai-test');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:000:web:abc');
    vi.stubEnv('VITE_API_URL', 'https://api.test.boosterchile.com');
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-recaptcha-site-key');
    vi.stubEnv('VITE_APPCHECK_PROVIDER', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    errorMock.mockClear();
  });

  describe('VITE_APPCHECK_PROVIDER', () => {
    it('ausente: usa recaptcha-v3, el proveedor de prod', async () => {
      vi.stubEnv('VITE_APPCHECK_PROVIDER', undefined);
      const { env } = await import('./env.js');
      expect(env.VITE_APPCHECK_PROVIDER).toBe('recaptcha-v3');
    });

    it('vacía (build-arg sin valor): usa recaptcha-v3', async () => {
      vi.stubEnv('VITE_APPCHECK_PROVIDER', '');
      const { env } = await import('./env.js');
      expect(env.VITE_APPCHECK_PROVIDER).toBe('recaptcha-v3');
    });

    it('acepta recaptcha-enterprise', async () => {
      vi.stubEnv('VITE_APPCHECK_PROVIDER', 'recaptcha-enterprise');
      const { env } = await import('./env.js');
      expect(env.VITE_APPCHECK_PROVIDER).toBe('recaptcha-enterprise');
    });

    it('un valor desconocido hace fallar la configuración', async () => {
      vi.stubEnv('VITE_APPCHECK_PROVIDER', 'turnstile');
      await expect(import('./env.js')).rejects.toThrow('Invalid env');
    });
  });

  it('contrato TRK-003: env inválido loguea error.flatten() de zod 3 y lanza', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.test.boosterchile.com/');
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', '');
    await expect(import('./env.js')).rejects.toThrow('Invalid env');
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "issues": {
            "fieldErrors": {
              "VITE_API_URL": [
                "VITE_API_URL must not end with slash",
              ],
              "VITE_RECAPTCHA_SITE_KEY": [
                "VITE_RECAPTCHA_SITE_KEY required",
              ],
            },
            "formErrors": [],
          },
        },
        "[env] Invalid environment configuration",
      ]
    `);
  });
});
