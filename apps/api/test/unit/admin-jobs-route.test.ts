import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

vi.mock('../../src/services/chat-whatsapp-fallback.js', () => ({
  procesarMensajesNoLeidos: vi.fn(),
}));

vi.mock('../../src/services/procesar-cobranza-cobra-hoy.js', () => ({
  procesarCobranzaCobraHoy: vi.fn(),
}));

vi.mock('../../src/services/cobrar-memberships-mensual.js', () => ({
  cobrarMembershipsMensual: vi.fn(),
}));

vi.mock('../../src/services/purgar-posiciones-movil.js', () => ({
  purgarPosicionesMovil: vi.fn(),
}));

vi.mock('../../src/jobs/reap-inert-idp-accounts.js', () => ({
  reapInertIdpAccounts: vi.fn(),
  fetchReaperFacts: vi.fn(),
  DEFAULT_MAX_DELETES_PER_RUN: 50,
}));

vi.mock('../../src/jobs/reap-orphan-onboarding-firebase.js', () => ({
  reapOrphanOnboardingFirebaseUsers: vi.fn(),
  listOnboardingOrphans: vi.fn(),
  markOnboardingOrphanReaped: vi.fn(),
  DEFAULT_ORPHAN_MAX_DELETES_PER_RUN: 50,
}));

const { procesarMensajesNoLeidos } = await import('../../src/services/chat-whatsapp-fallback.js');
const { reapInertIdpAccounts } = await import('../../src/jobs/reap-inert-idp-accounts.js');
const { reapOrphanOnboardingFirebaseUsers } = await import(
  '../../src/jobs/reap-orphan-onboarding-firebase.js'
);
const { procesarCobranzaCobraHoy } = await import(
  '../../src/services/procesar-cobranza-cobra-hoy.js'
);
const { purgarPosicionesMovil } = await import('../../src/services/purgar-posiciones-movil.js');
const { cobrarMembershipsMensual } = await import(
  '../../src/services/cobrar-memberships-mensual.js'
);
const { config: appConfig } = await import('../../src/config.js');

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

async function buildApp(extra: { firebaseAuth?: unknown; pool?: unknown } = {}) {
  const { createAdminJobsRoutes } = await import('../../src/routes/admin-jobs.js');
  const app = new Hono();
  app.route(
    '/admin/jobs',
    createAdminJobsRoutes({
      db: {} as never,
      logger: noopLogger,
      twilioClient: null,
      contentSidChatUnread: null,
      webAppUrl: 'https://app.test',
      firebaseAuth: (extra.firebaseAuth ?? null) as never,
      pool: (extra.pool ?? null) as never,
    }),
  );
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /admin/jobs/chat-whatsapp-fallback', () => {
  it('happy path: 200 con counts del service', async () => {
    (procesarMensajesNoLeidos as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      candidates: 5,
      notified: 3,
      skippedNoOwner: 1,
      skippedNoWhatsapp: 1,
      errored: 0,
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/chat-whatsapp-fallback', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; notified: number };
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(3);
  });

  it('service retorna 0 candidatos: igual 200 ok=true', async () => {
    (procesarMensajesNoLeidos as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      candidates: 0,
      notified: 0,
      skippedNoOwner: 0,
      skippedNoWhatsapp: 0,
      errored: 0,
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/chat-whatsapp-fallback', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('POST /admin/jobs/cobra-hoy-cobranza', () => {
  beforeEach(() => {
    appConfig.FACTORING_V1_ACTIVATED = true;
  });

  it('flag off → 200 skipped:true sin invocar service', async () => {
    appConfig.FACTORING_V1_ACTIVATED = false;
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobra-hoy-cobranza', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped: boolean; reason: string };
    expect(body).toEqual({ ok: true, skipped: true, reason: 'feature_disabled' });
    expect(procesarCobranzaCobraHoy).not.toHaveBeenCalled();
  });

  it('happy path: 200 con counts y adelantos serializados', async () => {
    (procesarCobranzaCobraHoy as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      morasCreadas: 2,
      adelantos: [
        {
          adelantoId: 'a1',
          empresaCarrierId: 'c1',
          empresaShipperId: 's1',
          diasVencidos: 5,
        },
        {
          adelantoId: 'a2',
          empresaCarrierId: 'c2',
          empresaShipperId: 's2',
          diasVencidos: 12,
        },
      ],
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobra-hoy-cobranza', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      moras_creadas: number;
      adelantos: Array<{ adelanto_id: string; dias_vencidos: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.moras_creadas).toBe(2);
    expect(body.adelantos).toEqual([
      {
        adelanto_id: 'a1',
        empresa_carrier_id: 'c1',
        empresa_shipper_id: 's1',
        dias_vencidos: 5,
      },
      {
        adelanto_id: 'a2',
        empresa_carrier_id: 'c2',
        empresa_shipper_id: 's2',
        dias_vencidos: 12,
      },
    ]);
  });

  it('cero candidatos: 200 con moras_creadas=0', async () => {
    (procesarCobranzaCobraHoy as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      morasCreadas: 0,
      adelantos: [],
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobra-hoy-cobranza', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { moras_creadas: number; adelantos: unknown[] };
    expect(body.moras_creadas).toBe(0);
    expect(body.adelantos).toEqual([]);
  });
});

describe('POST /admin/jobs/purgar-posiciones-movil', () => {
  it('happy path: 200 con deleted + retention_days (spec feat-retencion T3)', async () => {
    (purgarPosicionesMovil as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      deleted: 42,
      retentionDays: 30,
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/purgar-posiciones-movil', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 42, retention_days: 30 });
    expect(purgarPosicionesMovil).toHaveBeenCalledOnce();
  });
});

describe('POST /admin/jobs/reap-inert-idp-accounts (T9)', () => {
  beforeEach(() => {
    appConfig.REAPER_DESTRUCTIVE = false;
  });

  it('deps faltantes (sin firebaseAuth/pool) → 503 skipped, sin invocar el reaper', async () => {
    const app = await buildApp();
    const res = await app.request('/admin/jobs/reap-inert-idp-accounts', { method: 'POST' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; skipped: boolean; reason: string };
    expect(body).toEqual({ ok: true, skipped: true, reason: 'deps_missing' });
    expect(reapInertIdpAccounts).not.toHaveBeenCalled();
  });

  it('dry-run por defecto (REAPER_DESTRUCTIVE=false): 200 con summary + destructive:false', async () => {
    (reapInertIdpAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scanned: 3,
      actions: { disable: 1, delete: 0, wait: 0, skip: 2 },
    });
    const app = await buildApp({ firebaseAuth: {}, pool: { query: vi.fn() } });
    const res = await app.request('/admin/jobs/reap-inert-idp-accounts', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      destructive: boolean;
      scanned: number;
      actions: Record<string, number>;
    };
    expect(body.ok).toBe(true);
    expect(body.destructive).toBe(false);
    expect(body.scanned).toBe(3);
    // el flag destructive se pasa server-side desde config, no desde el request
    const passedConfig = (reapInertIdpAccounts as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(passedConfig.destructive).toBe(false);
    expect(passedConfig.neverReapable.has('dev@boosterchile.com')).toBe(true);
  });

  it('P1-4: un request con body/query destructive:true NO puede forzar el modo (C-G2)', async () => {
    appConfig.REAPER_DESTRUCTIVE = false;
    (reapInertIdpAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scanned: 0,
      actions: { disable: 0, delete: 0, wait: 0, skip: 0 },
    });
    const app = await buildApp({ firebaseAuth: {}, pool: { query: vi.fn() } });
    const res = await app.request('/admin/jobs/reap-inert-idp-accounts?destructive=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destructive: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { destructive: boolean };
    expect(body.destructive).toBe(false);
    const passedConfig = (reapInertIdpAccounts as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(passedConfig.destructive).toBe(false);
  });

  it('REAPER_DESTRUCTIVE=true → pasa destructive:true al runner', async () => {
    appConfig.REAPER_DESTRUCTIVE = true;
    (reapInertIdpAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scanned: 1,
      actions: { disable: 1, delete: 0, wait: 0, skip: 0 },
    });
    const app = await buildApp({ firebaseAuth: {}, pool: { query: vi.fn() } });
    const res = await app.request('/admin/jobs/reap-inert-idp-accounts', { method: 'POST' });
    expect(res.status).toBe(200);
    const passedConfig = (reapInertIdpAccounts as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(passedConfig.destructive).toBe(true);
  });
});

describe('POST /admin/jobs/reap-orphan-onboarding-firebase (W1.5 — onboarding-flow-redesign T1.7)', () => {
  beforeEach(() => {
    appConfig.ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE = false;
  });

  it('deps faltantes (sin firebaseAuth/pool) → 503 skipped, sin invocar el reaper', async () => {
    const app = await buildApp();
    const res = await app.request('/admin/jobs/reap-orphan-onboarding-firebase', {
      method: 'POST',
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; skipped: boolean; reason: string };
    expect(body).toEqual({ ok: true, skipped: true, reason: 'deps_missing' });
    expect(reapOrphanOnboardingFirebaseUsers).not.toHaveBeenCalled();
  });

  it('dry-run por defecto (ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE=false): 200 con summary + destructive:false', async () => {
    (reapOrphanOnboardingFirebaseUsers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scanned: 2,
      deleted: 2,
      alreadyGone: 0,
      deferred: 0,
      errors: 0,
    });
    const app = await buildApp({ firebaseAuth: {}, pool: { query: vi.fn() } });
    const res = await app.request('/admin/jobs/reap-orphan-onboarding-firebase', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      destructive: boolean;
      scanned: number;
      deleted: number;
    };
    expect(body.ok).toBe(true);
    expect(body.destructive).toBe(false);
    expect(body.scanned).toBe(2);
    expect(body.deleted).toBe(2);
    // el flag destructive se pasa server-side desde config, no desde el request
    const passedConfig = (reapOrphanOnboardingFirebaseUsers as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(passedConfig.destructive).toBe(false);
  });

  it('P1-4 (mismo patrón que reap-inert-idp-accounts): un request con body destructive:true NO puede forzar el modo', async () => {
    appConfig.ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE = false;
    (reapOrphanOnboardingFirebaseUsers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scanned: 0,
      deleted: 0,
      alreadyGone: 0,
      deferred: 0,
      errors: 0,
    });
    const app = await buildApp({ firebaseAuth: {}, pool: { query: vi.fn() } });
    const res = await app.request('/admin/jobs/reap-orphan-onboarding-firebase?destructive=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destructive: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { destructive: boolean };
    expect(body.destructive).toBe(false);
    const passedConfig = (reapOrphanOnboardingFirebaseUsers as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(passedConfig.destructive).toBe(false);
  });

  it('ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE=true → pasa destructive:true al runner', async () => {
    appConfig.ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE = true;
    (reapOrphanOnboardingFirebaseUsers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scanned: 1,
      deleted: 1,
      alreadyGone: 0,
      deferred: 0,
      errors: 0,
    });
    const app = await buildApp({ firebaseAuth: {}, pool: { query: vi.fn() } });
    const res = await app.request('/admin/jobs/reap-orphan-onboarding-firebase', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const passedConfig = (reapOrphanOnboardingFirebaseUsers as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(passedConfig.destructive).toBe(true);
  });
});

describe('POST /admin/jobs/cobrar-memberships-mensual (gap B5)', () => {
  beforeEach(() => {
    appConfig.PRICING_V2_ACTIVATED = true;
  });
  afterEach(() => {
    appConfig.PRICING_V2_ACTIVATED = false;
  });

  it('flag off → 200 skipped:true sin invocar el service', async () => {
    appConfig.PRICING_V2_ACTIVATED = false;
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobrar-memberships-mensual', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped: boolean; reason: string };
    expect(body).toEqual({ ok: true, skipped: true, reason: 'feature_disabled' });
    expect(cobrarMembershipsMensual).not.toHaveBeenCalled();
  });

  it('happy path: 200 con counts snake_case + payment_rail_stubbed:true', async () => {
    (cobrarMembershipsMensual as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ok',
      periodoMes: '2026-06',
      evaluadas: 2,
      facturasCreadas: 2,
      reintentos: 0,
      pendingProvider: 2,
      cobradas: 0,
      morosas: 0,
      yaFacturadas: 0,
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobrar-memberships-mensual', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      periodo_mes: '2026-06',
      evaluadas: 2,
      facturas_creadas: 2,
      reintentos: 0,
      pending_provider: 2,
      cobradas: 0,
      morosas: 0,
      ya_facturadas: 0,
      payment_rail_stubbed: true,
    });
  });

  it('service retorna skipped_flag_disabled (defensa) → 200 skipped', async () => {
    (cobrarMembershipsMensual as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'skipped_flag_disabled',
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobrar-memberships-mensual', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped: boolean };
    expect(body.skipped).toBe(true);
  });
});
