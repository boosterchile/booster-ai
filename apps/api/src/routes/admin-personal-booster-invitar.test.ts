import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImpersonationWriteGuardMiddleware } from '../middleware/impersonation-write-guard.js';
import type { EmailSender } from '../services/notifications/email-sender.js';
import { createAdminPersonalBoosterRoutes } from './admin-personal-booster.js';

/**
 * ADR-093 — POST /admin/personal-booster/invitar (slice invite email-only).
 */

const observabilidad = vi.hoisted(() => ({
  contadores: [] as Array<{ nombre: string; labels: Record<string, unknown> }>,
}));
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: (nombre: string) => ({
    add: (_v: number, labels: Record<string, unknown> = {}) => {
      observabilidad.contadores.push({ nombre, labels });
    },
  }),
}));
vi.mock('../observability/business-span.js', () => ({
  withBusinessSpan: async (
    _o: { name: string; attributes?: Record<string, unknown> },
    fn: (span: { atributos: Record<string, unknown> }) => Promise<unknown>,
  ) => fn({ atributos: {} }),
  setResultAttributes: (
    span: { atributos: Record<string, unknown> },
    attrs: Record<string, unknown>,
  ) => {
    Object.assign(span.atributos, attrs);
  },
}));

const ADMIN_EMAIL = 'dev@boosterchile.com';
const ADMIN_ID = '2b0c1f4e-7d65-4f0e-9a9b-6f1b2d3c4e5f';
const INV_ID = '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d';
const CORREO = 'gerencia@boosterchile.com';
const WEB = 'https://app.boosterchile.com';

const dbDelImpersonador = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ email: ADMIN_EMAIL, isPlatformAdmin: true, status: 'activo' }],
      }),
    }),
  }),
} as never;

function makeLogger(): Logger & { info: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  const l = {
    trace: () => undefined,
    debug: () => undefined,
    info,
    warn: vi.fn(),
    error: vi.fn(),
    fatal: () => undefined,
    child: () => l,
  };
  return l as unknown as Logger & { info: ReturnType<typeof vi.fn> };
}

function makeSender() {
  const send = vi.fn<EmailSender['send']>(async () => ({ enviado: true, id: 'm-1' }));
  return { sender: { send } as EmailSender, send };
}

function mount(db: unknown, sender: EmailSender) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userContext', {
      user: {
        id: ADMIN_ID,
        email: ADMIN_EMAIL,
        isPlatformAdmin: true,
        status: 'activo',
        firebaseUid: 'fb-admin',
        fullName: 'Admin',
        rut: null,
      },
      memberships: [],
    } as never);
    await next();
  });
  app.use(
    '*',
    createImpersonationWriteGuardMiddleware({
      db: dbDelImpersonador,
      logger: makeLogger(),
      platformAdminEmails: [ADMIN_EMAIL],
    }),
  );
  app.route(
    '/admin/personal-booster',
    createAdminPersonalBoosterRoutes({
      db: db as never,
      logger: makeLogger(),
      platformAdminEmails: [ADMIN_EMAIL],
      emailSender: sender,
      webAppUrl: WEB,
    }),
  );
  return app;
}

describe('POST /admin/personal-booster/invitar', () => {
  beforeEach(() => {
    observabilidad.contadores.length = 0;
  });

  it('usuario nuevo → 201 + mail con /crear-cuenta y sin token en logs', async () => {
    const { sender, send } = makeSender();
    const logger = makeLogger();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          delete: () => ({ where: async () => undefined }),
          insert: () => ({
            values: () => ({
              returning: async () => [{ id: INV_ID }],
            }),
          }),
        };
        return fn(tx);
      },
    };

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userContext', {
        user: {
          id: ADMIN_ID,
          email: ADMIN_EMAIL,
          isPlatformAdmin: true,
          status: 'activo',
          firebaseUid: 'fb-admin',
          fullName: 'Admin',
          rut: null,
        },
        memberships: [],
      } as never);
      await next();
    });
    app.use(
      '*',
      createImpersonationWriteGuardMiddleware({
        db: dbDelImpersonador,
        logger,
        platformAdminEmails: [ADMIN_EMAIL],
      }),
    );
    app.route(
      '/admin/personal-booster',
      createAdminPersonalBoosterRoutes({
        db: db as never,
        logger,
        platformAdminEmails: [ADMIN_EMAIL],
        emailSender: sender,
        webAppUrl: WEB,
      }),
    );

    const res = await app.request('/admin/personal-booster/invitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: CORREO }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      invitacion_id: string;
      email: string;
      expira_en: string;
    };
    expect(body.ok).toBe(true);
    expect(body.invitacion_id).toBe(INV_ID);
    expect(body.email).toBe(CORREO);
    expect(body.expira_en).toMatch(/Z$/);
    expect('token' in body).toBe(false);

    expect(send).toHaveBeenCalledOnce();
    const mail = send.mock.calls[0]?.[0] as { to: string; text: string; subject: string };
    expect(mail.to).toBe(CORREO);
    expect(mail.subject).toContain('personal de Booster');
    expect(mail.text).toContain(`${WEB}/crear-cuenta?token=`);

    const infoPayload = JSON.stringify(logger.info.mock.calls);
    expect(infoPayload).not.toMatch(/token=[A-Za-z0-9_-]{20,}/);
  });

  it('correo ya registrado → 409 email_already_registered sin mail', async () => {
    const { sender, send } = makeSender();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 'u-1' }],
          }),
        }),
      }),
      transaction: vi.fn(),
    };
    const app = mount(db, sender);
    const res = await app.request('/admin/personal-booster/invitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: CORREO }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', code: 'email_already_registered' });
    expect(send).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('body sin email → 400', async () => {
    const { sender } = makeSender();
    const app = mount({ select: vi.fn(), transaction: vi.fn() }, sender);
    const res = await app.request('/admin/personal-booster/invitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
