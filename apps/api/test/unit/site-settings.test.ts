/**
 * Tests minimal del endpoint público GET /public/site-settings.
 *
 * Los endpoints admin tienen guards de auth idénticos al patrón ya
 * probado en admin-seed.test.ts (requirePlatformAdmin + allowlist
 * BOOSTER_PLATFORM_ADMIN_EMAILS). No re-testeamos eso aquí.
 *
 * Tests cubren:
 *   - GET /public/site-settings devuelve la versión publicada.
 *   - GET /public/site-settings 404 cuando no hay publicada.
 *   - Headers de cache-control para CDN.
 */

import { DEFAULT_SITE_CONFIG } from '@booster-ai/shared-schemas';
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
  version: number;
  config: typeof DEFAULT_SITE_CONFIG;
  creadoEn: Date;
}

function makeDbStub(rows: FakeRow[]) {
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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /public/site-settings', () => {
  it('devuelve la versión publicada con cache-control', async () => {
    const fakeRow: FakeRow = {
      version: 1,
      config: DEFAULT_SITE_CONFIG,
      creadoEn: new Date('2026-05-13T22:00:00Z'),
    };
    const db = makeDbStub([fakeRow]) as unknown as Parameters<
      typeof import('../../src/routes/site-settings.js').createPublicSiteSettingsRoutes
    >[0]['db'];
    const { createPublicSiteSettingsRoutes } = await import('../../src/routes/site-settings.js');
    const router = createPublicSiteSettingsRoutes({ db, logger: loggerStub });
    const res = await router.request('/site-settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; config: typeof DEFAULT_SITE_CONFIG };
    expect(body.version).toBe(1);
    expect(body.config.hero.headline_line1).toBe('Transporta más,');
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
  });

  it('404 cuando no hay versión publicada', async () => {
    const db = makeDbStub([]) as unknown as Parameters<
      typeof import('../../src/routes/site-settings.js').createPublicSiteSettingsRoutes
    >[0]['db'];
    const { createPublicSiteSettingsRoutes } = await import('../../src/routes/site-settings.js');
    const router = createPublicSiteSettingsRoutes({ db, logger: loggerStub });
    const res = await router.request('/site-settings');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no_published_version');
  });
});
