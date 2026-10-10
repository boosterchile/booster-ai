import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { type ConfigWakeWord, createMeWakeWordRoutes } from '../../src/routes/me-wake-word.js';
import type { UserContext } from '../../src/services/user-context.js';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const COMPLETA: ConfigWakeWord = {
  activado: true,
  accessKey: 'pv-access-key-real',
  keywordUrl: 'https://storage.googleapis.com/booster-wake-word/oye-booster-cl.ppn',
  modelUrl: 'https://storage.googleapis.com/booster-wake-word/porcupine_params_es.pv',
  sensibilidad: 0.6,
};

function app(config: ConfigWakeWord, conContexto = true) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (conContexto) {
      c.set('userContext', { user: { id: 'u1' } } as UserContext);
    }
    await next();
  });
  a.route('/me', createMeWakeWordRoutes({ logger, config }));
  return a;
}

describe('GET /me/wake-word (ADR-036, T10-22)', () => {
  it('con flag, AccessKey y modelos → disponible con la config para el SDK', async () => {
    const res = await app(COMPLETA).request('/me/wake-word');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      disponible: true,
      access_key: 'pv-access-key-real',
      keyword_url: COMPLETA.keywordUrl,
      model_url: COMPLETA.modelUrl,
      sensibilidad: 0.6,
    });
  });

  it.each([
    [{ ...COMPLETA, activado: false }, 'flag_apagado'],
    [{ ...COMPLETA, accessKey: undefined }, 'sin_access_key'],
    [{ ...COMPLETA, accessKey: 'ROTATE_ME_PICOVOICE_ACCESS_KEY' }, 'sin_access_key'],
    [{ ...COMPLETA, keywordUrl: undefined }, 'sin_modelo'],
    [{ ...COMPLETA, modelUrl: undefined }, 'sin_modelo'],
  ] as const)('no disponible: %o → %s, sin filtrar la clave', async (config, motivo) => {
    const res = await app(config).request('/me/wake-word');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ disponible: false, motivo });
    expect(JSON.stringify(body)).not.toContain('pv-access-key-real');
  });

  it('sin userContext → 401', async () => {
    const res = await app(COMPLETA, false).request('/me/wake-word');
    expect(res.status).toBe(401);
  });
});
