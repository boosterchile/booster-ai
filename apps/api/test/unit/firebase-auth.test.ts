import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'booster-ai-test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

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
  typeof import('../../src/middleware/firebase-auth.js').createFirebaseAuthMiddleware
>[0]['logger'];

/**
 * Stub de firebase-admin Auth.verifyIdToken para tests.
 *   - succeed(payload): resuelve con DecodedIdToken
 *   - fail(error): rechaza simulando token inválido / expirado / firma rota
 */
function stubFirebaseAuth(behavior: { succeed: Partial<DecodedIdToken> } | { fail: Error }): Auth {
  return {
    verifyIdToken: vi.fn(async () => {
      if ('fail' in behavior) {
        throw behavior.fail;
      }
      return behavior.succeed as DecodedIdToken;
    }),
  } as unknown as Auth;
}

async function buildAppWith(auth: Auth): Promise<Hono> {
  const { createFirebaseAuthMiddleware } = await import('../../src/middleware/firebase-auth.js');
  const app = new Hono();
  app.use(
    '/protected/*',
    createFirebaseAuthMiddleware({
      auth,
      logger: noopLogger,
    }),
  );
  app.get('/protected/whoami', (c) => {
    const claims = c.get('firebaseClaims') as
      | { uid: string; email?: string; name?: string }
      | undefined;
    return c.json({ ok: true, claims });
  });
  return app;
}

describe('firebase auth middleware', () => {
  it('rechaza request sin Authorization header con 401', async () => {
    const app = await buildAppWith(stubFirebaseAuth({ succeed: {} }));
    const res = await app.request('/protected/whoami');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('rechaza request con scheme distinto a Bearer con 401', async () => {
    const app = await buildAppWith(stubFirebaseAuth({ succeed: {} }));
    const res = await app.request('/protected/whoami', {
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
  });

  it('rechaza con 401 cuando verifyIdToken lanza (firma inválida)', async () => {
    const app = await buildAppWith(
      stubFirebaseAuth({ fail: new Error('Firebase ID token has invalid signature') }),
    );
    const res = await app.request('/protected/whoami', {
      headers: { authorization: 'Bearer fake.firebase.token' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid token' });
  });

  it('rechaza con 401 cuando verifyIdToken lanza por token expirado', async () => {
    const app = await buildAppWith(
      stubFirebaseAuth({ fail: new Error('Firebase ID token has expired') }),
    );
    const res = await app.request('/protected/whoami', {
      headers: { authorization: 'Bearer expired.firebase.token' },
    });
    expect(res.status).toBe(401);
  });

  it('acepta token válido y propaga claims al context', async () => {
    const app = await buildAppWith(
      stubFirebaseAuth({
        succeed: {
          uid: 'firebase-uid-abc',
          email: 'felipe@boosterchile.com',
          email_verified: true,
          name: 'Felipe Vicencio',
          picture: 'https://example.com/avatar.png',
        },
      }),
    );
    const res = await app.request('/protected/whoami', {
      headers: { authorization: 'Bearer valid.firebase.token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; claims: { uid: string; email?: string } };
    expect(body.ok).toBe(true);
    expect(body.claims.uid).toBe('firebase-uid-abc');
    expect(body.claims.email).toBe('felipe@boosterchile.com');
  });
});
