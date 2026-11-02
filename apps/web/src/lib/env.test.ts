import { describe, expect, it, vi } from 'vitest';

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));
vi.mock('./logger.js', () => ({ logger: { error: errorMock } }));

describe('env', () => {
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
