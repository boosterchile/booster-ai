import { inArray } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { empresas, memberships, plans, users } from '../../src/db/schema.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Integration (C5) — GET /auth/impersonate/targets filtra por
 * `es_usuario_prueba`, NO por `es_demo` (desacople ADR-053). Contra Postgres
 * real (migración 0050 auto-aplicada por globalSetup en CI):
 *   - usuario de empresa `es_usuario_prueba=true` → SÍ aparece,
 *   - usuario de empresa `es_demo=true` (no-prueba) → NO aparece,
 *   - platform-admin → NO aparece.
 */

vi.hoisted(() => {
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = 'admin-tgt-it@boosterchile.com';
  process.env.IMPERSONATION_V1_ACTIVATED = 'true';
});

const { createAuthImpersonateRoutes } = await import('../../src/routes/auth-impersonate.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

const S = 'imp-tgt-it';

describe('integration: /auth/impersonate/targets filtra por es_usuario_prueba (C5)', () => {
  let handle: TestDbHandle;
  const empresaIds: string[] = [];
  const userIds: string[] = [];
  let app: Hono;

  beforeAll(async () => {
    handle = createTestDb();

    // planId es un FK NOT NULL a `plans` (seedeado por migración 0002).
    const planRows = await handle.db.select({ id: plans.id }).from(plans).limit(1);
    const planId = planRows[0]?.id;
    if (!planId) {
      throw new Error('sin planes seedeados; migración 0002 debería haberlos creado');
    }

    function empresaValues(tag: string, flags: { isDemo?: boolean; isTestUser?: boolean }) {
      return {
        planId,
        name: `E ${tag}`,
        legalName: `Empresa ${tag} SpA`,
        rut: `${S}-${tag}`.slice(0, 20),
        contactEmail: `${S}-${tag}@e.invalid`,
        contactPhone: '+56900000000',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isDemo: flags.isDemo ?? false,
        isTestUser: flags.isTestUser ?? false,
      };
    }

    const [empTest] = await handle.db
      .insert(empresas)
      .values(empresaValues('test', { isTestUser: true }))
      .returning({ id: empresas.id });
    const [empDemo] = await handle.db
      .insert(empresas)
      .values(empresaValues('demo', { isDemo: true }))
      .returning({ id: empresas.id });
    empresaIds.push(empTest?.id ?? '', empDemo?.id ?? '');

    async function mkUser(tag: string, isAdmin: boolean): Promise<string> {
      const rows = await handle.db
        .insert(users)
        .values({
          firebaseUid: `fb-${S}-${tag}`,
          email: `${S}-${tag}@u.invalid`,
          fullName: `U ${tag}`,
          isPlatformAdmin: isAdmin,
        })
        .returning({ id: users.id });
      const id = rows[0]?.id ?? '';
      userIds.push(id);
      return id;
    }

    const uTest = await mkUser('test', false);
    const uDemo = await mkUser('demo', false);
    const uAdmin = await mkUser('admin', true);

    await handle.db.insert(memberships).values([
      { userId: uTest, empresaId: empTest?.id, role: 'dueno', status: 'activa' },
      { userId: uDemo, empresaId: empDemo?.id, role: 'dueno', status: 'activa' },
      { userId: uAdmin, empresaId: empTest?.id, role: 'admin', status: 'activa' },
    ]);

    app = new Hono();
    // userContext del admin (requirePlatformAdmin lee user.email vs allowlist).
    app.use('*', async (c, next) => {
      c.set('userContext', {
        user: { id: uAdmin, email: 'admin-tgt-it@boosterchile.com' },
        memberships: [],
        activeMembership: null,
        impersonatedBy: null,
      });
      await next();
    });
    app.route(
      '/auth',
      createAuthImpersonateRoutes({ db: handle.db, firebaseAuth: {} as Auth, logger }),
    );
  });

  afterAll(async () => {
    // Cleanup ordenado por FK: memberships → users → empresas de este test.
    if (userIds.length > 0) {
      await handle.db.delete(memberships).where(inArray(memberships.userId, userIds));
      await handle.db.delete(users).where(inArray(users.id, userIds));
    }
    if (empresaIds.length > 0) {
      await handle.db.delete(empresas).where(inArray(empresas.id, empresaIds));
    }
    await handle.pool.end();
  });

  test('lista solo el usuario de empresa es_usuario_prueba; NO el de es_demo ni el admin', async () => {
    const res = await app.request('/auth/impersonate/targets', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { targets: Array<{ full_name: string; empresa: string }> };
    const empresasListadas = body.targets.map((t) => t.empresa);
    expect(empresasListadas).toContain('Empresa test SpA');
    expect(empresasListadas).not.toContain('Empresa demo SpA');
    expect(body.targets.every((t) => t.full_name !== 'U admin')).toBe(true);
  });
});
