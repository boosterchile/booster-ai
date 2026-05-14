/**
 * Tests del endpoint público + admin de site-settings.
 *
 * Cubre los principales branches:
 *   - GET /public/site-settings: 200 + 404
 *   - requirePlatformAdmin guard: sin userContext, fuera de allowlist
 *   - GET /admin/site-settings: ok
 *   - GET /admin/site-settings/:version: invalid + not_found + ok
 *   - POST /draft: validation + ok
 *   - POST /publish: ok + db_error
 *   - POST /rollback: version_not_found + ok
 *   - POST /assets: multipart missing + mime not allowed + file too large
 *     + svg unsafe + ok
 */

import { DEFAULT_SITE_CONFIG, type SiteConfig } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerStub = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => loggerStub),
};

interface FakeRow {
  id: string;
  version: number;
  config: SiteConfig;
  publicada: boolean;
  notaPublicacion: string | null;
  creadoPorEmail: string;
  creadoEn: Date;
}

function makePublishedStub(rows: FakeRow[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  };
}

function makeAdminStub(opts: {
  publishedRow: FakeRow | null;
  history: FakeRow[];
  byVersion?: FakeRow | null;
  maxVersion?: number;
  insertResult?: FakeRow;
  txError?: Error;
}) {
  return {
    select: vi.fn().mockImplementation((cols?: Record<string, unknown>) => ({
      from: () => ({
        // Path: where → limit (used by /admin/ GET single + /admin/:version + rollback target lookup)
        where: () => ({
          limit: async () => {
            if (opts.byVersion !== undefined) {
              return opts.byVersion ? [opts.byVersion] : [];
            }
            return opts.publishedRow ? [opts.publishedRow] : [];
          },
        }),
        // Path: orderBy → limit (used by /admin/ GET history)
        orderBy: () => ({
          limit: async () => opts.history,
        }),
        // Path: select max (no where) — for /draft
        ...(cols && 'maxVersion' in cols
          ? {
              /* not used here, max returns via this object's select */
            }
          : {}),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: () => ({
        returning: async () => (opts.insertResult ? [opts.insertResult] : []),
      }),
    }),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      if (opts.txError) {
        throw opts.txError;
      }
      // Stub mínimo de tx (update().set().where()).
      const tx = {
        update: () => ({
          set: () => ({
            where: async () => undefined,
          }),
        }),
      };
      await cb(tx);
    }),
  };
}

/**
 * Stub específico para el endpoint /draft que necesita select max(version).
 * Drizzle: db.select({maxVersion: max(...)}).from(...). El stub devuelve
 * el array con un objeto cuando llamamos .from() directo (sin where ni limit).
 */
function makeDraftStub(maxVersion: number, insertResult: FakeRow) {
  // biome-ignore lint/suspicious/noExplicitAny: stub flexible — usado solo en tests.
  const fromObj: any = [{ maxVersion }];
  // Make .from() return [maxRow] when awaited (drizzle's pattern: await db.select(...).from(...))
  return {
    select: vi.fn().mockImplementation((cols?: Record<string, unknown>) => {
      if (cols && 'maxVersion' in cols) {
        return {
          from: () => fromObj,
        };
      }
      // Otros selects (no usados en /draft) — pero damos un fallback seguro.
      return {
        from: () => ({
          where: () => ({ limit: async () => [] }),
          orderBy: () => ({ limit: async () => [] }),
        }),
      };
    }),
    insert: vi.fn().mockReturnValue({
      values: () => ({
        returning: async () => [insertResult],
      }),
    }),
  };
}

// User contexts para los tests.
const adminCtx = {
  user: { email: 'dev@boosterchile.com', uid: 'admin-uid' },
};
const notAdminCtx = {
  user: { email: 'random@gmail.com', uid: 'user-uid' },
};

const fakeRow: FakeRow = {
  id: 'abc-uuid',
  version: 1,
  config: DEFAULT_SITE_CONFIG,
  publicada: true,
  notaPublicacion: 'Seed',
  creadoPorEmail: 'system',
  creadoEn: new Date('2026-05-13T22:00:00Z'),
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('BOOSTER_PLATFORM_ADMIN_EMAILS', 'dev@boosterchile.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function buildAdminApp(
  // biome-ignore lint/suspicious/noExplicitAny: db stub flexible.
  db: any,
  ctx: typeof adminCtx | typeof notAdminCtx | null,
) {
  const { createSiteSettingsRoutes } = await import('../../src/routes/site-settings.js');
  const app = new Hono();
  if (ctx) {
    app.use('*', async (c, next) => {
      c.set('userContext', ctx);
      await next();
    });
  }
  app.route(
    '/admin/site-settings',
    createSiteSettingsRoutes({ db, logger: loggerStub, publicAssetsBucket: 'test-bucket' }),
  );
  return app;
}

describe('GET /public/site-settings', () => {
  it('devuelve la versión publicada con cache-control', async () => {
    const db = makePublishedStub([fakeRow]) as unknown as Parameters<
      typeof import('../../src/routes/site-settings.js').createPublicSiteSettingsRoutes
    >[0]['db'];
    const { createPublicSiteSettingsRoutes } = await import('../../src/routes/site-settings.js');
    const router = createPublicSiteSettingsRoutes({ db, logger: loggerStub });
    const res = await router.request('/site-settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; config: SiteConfig };
    expect(body.version).toBe(1);
    expect(body.config.hero.headline_line1).toBe('Transporta más,');
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
  });

  it('404 cuando no hay versión publicada', async () => {
    const db = makePublishedStub([]) as unknown as Parameters<
      typeof import('../../src/routes/site-settings.js').createPublicSiteSettingsRoutes
    >[0]['db'];
    const { createPublicSiteSettingsRoutes } = await import('../../src/routes/site-settings.js');
    const router = createPublicSiteSettingsRoutes({ db, logger: loggerStub });
    const res = await router.request('/site-settings');
    expect(res.status).toBe(404);
  });
});

describe('Admin guards (requirePlatformAdmin)', () => {
  it('GET /admin/site-settings sin userContext → 401', async () => {
    const db = makeAdminStub({ publishedRow: fakeRow, history: [fakeRow] });
    const app = await buildAdminApp(db, null);
    const res = await app.request('/admin/site-settings');
    expect(res.status).toBe(401);
  });

  it('GET /admin/site-settings fuera de allowlist → 403', async () => {
    const db = makeAdminStub({ publishedRow: fakeRow, history: [fakeRow] });
    const app = await buildAdminApp(db, notAdminCtx);
    const res = await app.request('/admin/site-settings');
    expect(res.status).toBe(403);
  });

  it('GET /admin/site-settings admin OK → published + history', async () => {
    const db = makeAdminStub({ publishedRow: fakeRow, history: [fakeRow] });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published: FakeRow; history: FakeRow[] };
    expect(body.published.version).toBe(1);
    expect(body.history.length).toBe(1);
  });
});

describe('GET /admin/site-settings/:version', () => {
  it('version inválida → 400', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [], byVersion: null });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/not-a-number');
    expect(res.status).toBe(400);
  });

  it('version not found → 404', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [], byVersion: null });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/999');
    expect(res.status).toBe(404);
  });

  it('version encontrada → 200', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [], byVersion: fakeRow });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/1');
    expect(res.status).toBe(200);
  });
});

describe('POST /admin/site-settings/draft', () => {
  it('body inválido (config no pasa Zod) → 400', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { invalid: true } }),
    });
    expect(res.status).toBe(400);
  });

  it('admin OK → crea draft con next version', async () => {
    const db = makeDraftStub(5, { ...fakeRow, version: 6, publicada: false });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: DEFAULT_SITE_CONFIG, nota: 'test' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; draft: FakeRow };
    expect(body.ok).toBe(true);
    expect(body.draft.version).toBe(6);
  });
});

describe('POST /admin/site-settings/publish', () => {
  it('body inválido (id no UUID) → 400', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'not-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('transaction OK → 200', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001' }),
    });
    expect(res.status).toBe(200);
  });

  it('transaction error → 500', async () => {
    const db = makeAdminStub({
      publishedRow: null,
      history: [],
      txError: new Error('db down'),
    });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /admin/site-settings/rollback', () => {
  it('version no existe → 404', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [], byVersion: null });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/rollback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_version: 99 }),
    });
    expect(res.status).toBe(404);
  });

  it('rollback OK → 200', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [], byVersion: fakeRow });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/rollback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_version: 1 }),
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /admin/site-settings/assets', () => {
  it('sin multipart → 400', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const res = await app.request('/admin/site-settings/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('multipart sin file → 400', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const form = new FormData();
    form.append('not_file', 'oops');
    const res = await app.request('/admin/site-settings/assets', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('mime no permitido → 400', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const form = new FormData();
    form.append(
      'file',
      new File(['malicious binary'], 'evil.exe', { type: 'application/octet-stream' }),
    );
    const res = await app.request('/admin/site-settings/assets', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('mime_not_allowed');
  });

  it('file demasiado grande → 413', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const form = new FormData();
    const bigData = new Uint8Array(600 * 1024); // 600 KB > 500 KB max
    form.append('file', new File([bigData], 'big.png', { type: 'image/png' }));
    const res = await app.request('/admin/site-settings/assets', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(413);
  });

  it('SVG con <script> → 400 svg_unsafe_content', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const form = new FormData();
    const malicious = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    form.append('file', new File([malicious], 'bad.svg', { type: 'image/svg+xml' }));
    const res = await app.request('/admin/site-settings/assets', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('svg_unsafe_content');
  });

  it('SVG con onload handler → 400 svg_unsafe_content', async () => {
    const db = makeAdminStub({ publishedRow: null, history: [] });
    const app = await buildAdminApp(db, adminCtx);
    const form = new FormData();
    const malicious = '<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"></svg>';
    form.append('file', new File([malicious], 'bad.svg', { type: 'image/svg+xml' }));
    const res = await app.request('/admin/site-settings/assets', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });
});
