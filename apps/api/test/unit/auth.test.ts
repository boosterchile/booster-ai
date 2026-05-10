import type { LoginTicket, OAuth2Client, TokenPayload } from 'google-auth-library';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  // Necesario para que el import de '../../src/middleware/auth.js' no
  // dispare el parse de config (los tests del middleware no lo necesitan,
  // pero el chain de imports los toca transitivamente).
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com,https://booster-ai-api.run.app';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

const ALLOWED_SA = 'caller@booster-ai.iam.gserviceaccount.com';
const AUDIENCE = ['https://api.boosterchile.com', 'https://booster-ai-api.run.app'];

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/middleware/auth.js').createAuthMiddleware
>[0]['logger'];

/**
 * Stub de OAuth2Client.verifyIdToken para tests:
 *   - `succeed(payload)` → resuelve con un ticket que devuelve ese payload
 *   - `fail(error)` → rechaza con error (simula firma inválida, aud mismatch,
 *     exp pasado — todo lo que verifyIdToken valida internamente)
 */
function stubOauthClient(
  behavior: { succeed: TokenPayload | null } | { fail: Error },
): OAuth2Client {
  return {
    verifyIdToken: vi.fn(async () => {
      if ('fail' in behavior) {
        throw behavior.fail;
      }
      return {
        getPayload: () => behavior.succeed,
      } as LoginTicket;
    }),
  } as unknown as OAuth2Client;
}

async function buildAppWith(oauthClient: OAuth2Client): Promise<Hono> {
  const { createAuthMiddleware } = await import('../../src/middleware/auth.js');
  const app = new Hono();
  app.use(
    '/protected/*',
    createAuthMiddleware({
      apiAudience: AUDIENCE,
      allowedCallerSa: ALLOWED_SA,
      logger: noopLogger,
      oauthClient,
    }),
  );
  app.get('/protected/ping', (c) => c.json({ ok: true, callerSa: c.get('callerSa') }));
  return app;
}

describe('auth middleware (JWT signature verification — #AUTH-HARDEN-001)', () => {
  it('rechaza request sin Authorization header con 401', async () => {
    const app = await buildAppWith(stubOauthClient({ succeed: null }));
    const res = await app.request('/protected/ping');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('rechaza request con scheme distinto a Bearer con 401', async () => {
    const app = await buildAppWith(stubOauthClient({ succeed: null }));
    const res = await app.request('/protected/ping', {
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
  });

  it('rechaza token cuando verifyIdToken lanza (firma inválida) con 401', async () => {
    // Esto es el caso CRÍTICO que cierra #AUTH-HARDEN-001: antes la firma
    // ni se chequeaba; ahora un JWT mal firmado = 401 antes de evaluar
    // cualquier otro claim.
    const app = await buildAppWith(stubOauthClient({ fail: new Error('Invalid token signature') }));
    const res = await app.request('/protected/ping', {
      headers: { authorization: 'Bearer fake.jwt.signature' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid token' });
  });

  it('rechaza cuando verifyIdToken lanza por aud mismatch con 401', async () => {
    const app = await buildAppWith(
      stubOauthClient({ fail: new Error('Wrong recipient: aud claim does not match') }),
    );
    const res = await app.request('/protected/ping', {
      headers: { authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(401);
  });

  it('rechaza cuando payload viene vacío con 401', async () => {
    const app = await buildAppWith(stubOauthClient({ succeed: null }));
    const res = await app.request('/protected/ping', {
      headers: { authorization: 'Bearer some.jwt.token' },
    });
    expect(res.status).toBe(401);
  });

  it('rechaza cuando exp está en el pasado con 401 (defense in depth)', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const app = await buildAppWith(
      stubOauthClient({
        succeed: { email: ALLOWED_SA, exp: past, aud: AUDIENCE[0] } as TokenPayload,
      }),
    );
    const res = await app.request('/protected/ping', {
      headers: { authorization: 'Bearer valid.but.expired' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Token expired' });
  });

  it('rechaza cuando email no está en la whitelist allowedCallerSa con 403', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const app = await buildAppWith(
      stubOauthClient({
        succeed: {
          email: 'random@google.iam.gserviceaccount.com',
          exp: future,
          aud: AUDIENCE[0],
        } as TokenPayload,
      }),
    );
    const res = await app.request('/protected/ping', {
      headers: { authorization: 'Bearer valid.token.wrong.caller' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Caller not allowed' });
  });

  it('acepta token bien firmado + aud + caller correctos y propaga callerSa al context', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const app = await buildAppWith(
      stubOauthClient({
        succeed: {
          email: ALLOWED_SA,
          exp: future,
          aud: AUDIENCE[1], // *.run.app (válido — está en el array)
        } as TokenPayload,
      }),
    );
    const res = await app.request('/protected/ping', {
      headers: { authorization: 'Bearer valid.token.correct.caller' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, callerSa: ALLOWED_SA });
  });
});
