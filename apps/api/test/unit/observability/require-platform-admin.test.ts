import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { requirePlatformAdmin } from '../../../src/middleware/require-platform-admin.js';

/**
 * Tests del middleware admin reusable (extract de admin-cobra-hoy).
 * Mock del Hono Context inline para evitar setup de toda la app.
 *
 * BOOSTER_PLATFORM_ADMIN_EMAILS default en test env = `['dev@boosterchile.com']`
 * (proviene de la config zod default cuando la env var no está).
 */

function makeMockContext(opts: {
  userEmail?: string | null;
  hasUserContext?: boolean;
}): Context<any, any, any> {
  const userContext = opts.hasUserContext
    ? {
        user: { email: opts.userEmail ?? null },
      }
    : undefined;

  let lastResponse: { body: unknown; status: number } | null = null;

  return {
    get: (key: string) => (key === 'userContext' ? userContext : undefined),
    json: (body: unknown, status: number) => {
      lastResponse = { body, status };
      // mock simple — el guard sólo necesita un valor truthy con .status
      return { __mockBody: body, status, __getLast: () => lastResponse } as unknown as Response;
    },
  } as any;
}

describe('requirePlatformAdmin', () => {
  it('returns ok=true cuando el email está en allowlist y hay userContext', () => {
    const c = makeMockContext({
      userEmail: 'dev@boosterchile.com',
      hasUserContext: true,
    });
    const result = requirePlatformAdmin(c);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.adminEmail).toBe('dev@boosterchile.com');
      expect(result.userContext.user.email).toBe('dev@boosterchile.com');
    }
  });

  it('returns 401 cuando NO hay userContext (Firebase auth missing)', () => {
    const c = makeMockContext({ hasUserContext: false });
    const result = requirePlatformAdmin(c);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = (result.response as unknown as { __mockBody: { error: string }; status: number })
        .__mockBody;
      const status = (result.response as unknown as { status: number }).status;
      expect(status).toBe(401);
      expect(body.error).toBe('unauthorized');
    }
  });

  it('returns 403 cuando el email NO está en allowlist', () => {
    const c = makeMockContext({
      userEmail: 'random-user@gmail.com',
      hasUserContext: true,
    });
    const result = requirePlatformAdmin(c);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = (result.response as unknown as { __mockBody: { error: string } }).__mockBody;
      const status = (result.response as unknown as { status: number }).status;
      expect(status).toBe(403);
      expect(body.error).toBe('forbidden_platform_admin');
    }
  });

  it('returns 503 cuando featureFlag=false (kill-switch)', () => {
    const c = makeMockContext({
      userEmail: 'dev@boosterchile.com',
      hasUserContext: true,
    });
    const result = requirePlatformAdmin(c, { featureFlag: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = (result.response as unknown as { __mockBody: { error: string } }).__mockBody;
      const status = (result.response as unknown as { status: number }).status;
      expect(status).toBe(503);
      expect(body.error).toBe('feature_disabled');
    }
  });

  it('email comparison is case-insensitive (allowlist lowercased)', () => {
    const c = makeMockContext({
      userEmail: 'DEV@BoosterChile.COM',
      hasUserContext: true,
    });
    const result = requirePlatformAdmin(c);
    expect(result.ok).toBe(true);
  });

  it('userContext con email=null/undefined falla con 403', () => {
    const c = makeMockContext({
      userEmail: null,
      hasUserContext: true,
    });
    const result = requirePlatformAdmin(c);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const status = (result.response as unknown as { status: number }).status;
      expect(status).toBe(403);
    }
  });

  it('featureFlag=true permite continuar al check de auth', () => {
    const c = makeMockContext({ hasUserContext: false });
    const result = requirePlatformAdmin(c, { featureFlag: true });
    // featureFlag pasa pero auth falla → 401, no 503
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const status = (result.response as unknown as { status: number }).status;
      expect(status).toBe(401);
    }
  });
});
