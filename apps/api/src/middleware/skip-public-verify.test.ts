import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { skipPublicVerify } from './skip-public-verify.js';

describe('skipPublicVerify', () => {
  function makeApp(mw: ReturnType<typeof skipPublicVerify>) {
    const app = new Hono();
    app.use('/certificates/*', mw);
    app.get('/certificates/:tracking/verify', (c) => c.json({ public: true }));
    app.get('/certificates', (c) => c.json({ list: true }));
    return app;
  }

  it('GET /certificates/:tracking/verify NO pasa por el middleware (público)', async () => {
    const inner = vi.fn(async (c) => c.json({ error: 'blocked' }, 401));
    const app = makeApp(skipPublicVerify(inner));

    const res = await app.request('/certificates/BOO-ABC123/verify');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ public: true });
    expect(inner).not.toHaveBeenCalled();
  });

  it('paths auth-required SÍ pasan por el middleware', async () => {
    const inner = vi.fn(async (c) => c.json({ error: 'blocked' }, 401));
    const app = makeApp(skipPublicVerify(inner));

    const res = await app.request('/certificates');
    expect(res.status).toBe(401);
    expect(inner).toHaveBeenCalledOnce();
  });

  it('POST al path verify NO se salta el middleware (solo GET es público)', async () => {
    const inner = vi.fn(async (c) => c.json({ error: 'blocked' }, 401));
    const app = makeApp(skipPublicVerify(inner));

    const res = await app.request('/certificates/BOO-ABC123/verify', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(inner).toHaveBeenCalledOnce();
  });

  it('middleware que deja pasar → la request continúa al handler', async () => {
    const inner = vi.fn(async (_c, next) => next());
    const app = makeApp(skipPublicVerify(inner));

    const res = await app.request('/certificates');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ list: true });
  });
});
