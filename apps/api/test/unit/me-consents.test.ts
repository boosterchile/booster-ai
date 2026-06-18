import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/me-consents.js').createMeConsentsRoutes
>[0]['logger'];

/**
 * DB stub que matchea el patrón fluent de Drizzle. Soporta select/insert/update.
 * Cada chain consume un resultado de las queues correspondientes.
 *
 * `insertSpy` captura el primer argumento pasado a `.values(...)` para poder
 * verificar qué columnas persiste `grantConsent` (evidencia 21.719).
 * `selectCount` lleva la cuenta de SELECTs ejecutados (para verificar que el
 * branch portafolio_viajes deniega ANTES de tocar la BD — O-1b, §11 caso 7).
 */
interface DbQueues {
  selects?: unknown[][];
  inserts?: unknown[][];
  updates?: unknown[][];
}

function makeDbStub(initial: DbQueues = {}) {
  const selects = [...(initial.selects ?? [])];
  const inserts = [...(initial.inserts ?? [])];
  const updates = [...(initial.updates ?? [])];

  const insertValues: unknown[] = [];
  let selectCount = 0;

  const buildSelectChain = () => {
    selectCount += 1;
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      const result = selects.shift() ?? [];
      return Promise.resolve(resolve(result));
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn((v: unknown) => {
      insertValues.push(v);
      return {
        returning: vi.fn(async () => inserts.shift() ?? []),
      };
    }),
  });

  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => updates.shift() ?? []),
      })),
    })),
  });

  return {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
    update: vi.fn(() => buildUpdateChain()),
    // Helpers de test (no parte del contrato Drizzle):
    __insertValues: insertValues,
    __selectCount: () => selectCount,
  };
}

const FB_UID = 'fb-uid-grantor';
const USER_ID = 'user-uuid-grantor';
// UUID válido para los tests de revoke (el handler valida que :id sea UUID).
const VALID_CONSENT_ID = '99999999-9999-9999-9999-999999999999';

const validClaimsHeader = JSON.stringify({ uid: FB_UID, email: 'a@b.c' });

async function buildApp(db: unknown) {
  const { createMeConsentsRoutes } = await import('../../src/routes/me-consents.js');
  const app = new Hono();
  app.use('/me/*', async (c, next) => {
    const claimsHeader = c.req.header('x-test-claims');
    if (claimsHeader) {
      const parsed = JSON.parse(claimsHeader) as { uid: string; email?: string };
      c.set('firebaseClaims', {
        uid: parsed.uid,
        email: parsed.email,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.route('/me/consents', createMeConsentsRoutes({ db: db as never, logger: noopLogger }));
  return app;
}

const validBody = {
  stakeholder_id: '11111111-1111-1111-1111-111111111111',
  scope_type: 'organizacion',
  scope_id: '22222222-2222-2222-2222-222222222222',
  data_categories: ['emisiones_carbono', 'certificados'],
  consent_document_url: 'https://docs.boosterchile.com/c/abc.pdf',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /me/consents', () => {
  it('rechaza request sin claims con 500', async () => {
    const db = makeDbStub({});
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(500);
  });

  it('user no registrado en BD → 404', async () => {
    const db = makeDbStub({ selects: [[]] }); // resolveUserId encuentra 0
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('user_not_registered');
  });

  // ── P1-B — IDOR cross-empresa (scopes de empresa) ───────────────────────

  it('P1-B caso 1: dueño de empresa A otorga sobre empresa B → 403 forbidden_scope_authority', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }], // resolveUserId
        [], // membership filtrada por empresaId=scopeId(B) → ninguna (el user no es de B)
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      // scope_id apunta a empresa B (ajena al user)
      body: JSON.stringify({ ...validBody, scope_id: '33333333-3333-3333-3333-333333333333' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_scope_authority');
  });

  it('P1-B caso 2: admin de la empresa del scope → 201', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }], // resolveUserId
        [{ id: 'm1' }], // membership filtrada matchea (dueno/admin activa en la empresa scope)
      ],
      inserts: [[{ id: 'new-consent-uuid' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { consent_id: string };
    expect(body.consent_id).toBe('new-consent-uuid');
  });

  it('P1-B caso 3: membership suspendida sobre la empresa correcta → 403 (filtra status=activa)', async () => {
    // El nuevo where filtra status='activa' → una membership suspendida no
    // matchea, la query devuelve []. El stub refleja ese resultado de la BD.
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [], // membership suspendida no pasa el filtro status='activa'
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_scope_authority');
  });

  it('P1-B caso 4: conductor/visualizador de la empresa del scope → 403 (filtra role)', async () => {
    // El nuevo where filtra role IN ('dueno','admin') → conductor/visualizador
    // no matchea, la query devuelve [].
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [], // role no es dueno/admin → no pasa el filtro
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_scope_authority');
  });

  it('P1-B caso 4b: cross-empresa también deniega en generador_carga y transportista → 403', async () => {
    // organizacion/generador_carga/transportista comparten el mismo camino de
    // autorización (misma query). Cubrir los 3 evita que una regresión que
    // ramifique por scopeType pase desapercibida (GAP-3 review seguridad).
    for (const scopeType of ['generador_carga', 'transportista'] as const) {
      const db = makeDbStub({
        selects: [[{ id: USER_ID }], []], // membership filtrada por empresa ajena → []
      });
      const app = await buildApp(db);
      const res = await app.request('/me/consents', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
        body: JSON.stringify({
          ...validBody,
          scope_type: scopeType,
          scope_id: '33333333-3333-3333-3333-333333333333',
        }),
      });
      expect(res.status, `scope_type=${scopeType}`).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('forbidden_scope_authority');
    }
  });

  // ── P0-B — IDOR portafolio_viajes (deny real, O-1b) ─────────────────────

  it('P0-B caso 5: portafolio_viajes con otorgante dueño/admin del scope_id → 403 (deny real)', async () => {
    // Aunque el user fuera dueño/admin activo del scope_id, el branch
    // portafolio deniega SIEMPRE (O-1b). Solo se consume el SELECT de
    // resolveUserId; no debe haber un SELECT de membership.
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }], // resolveUserId
        // Si el código (incorrectamente) consultara membership, encontraría
        // un dueño activo. El test prueba que NO se llega a consumirlo.
        [{ id: 'm1' }],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, scope_type: 'portafolio_viajes' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_scope_authority');
  });

  it('P0-B caso 6: portafolio_viajes con scope_id arbitrario / sin membership → 403', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, scope_type: 'portafolio_viajes' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_scope_authority');
  });

  it('P0-B caso 7: portafolio_viajes deniega ANTES de tocar la BD (solo resolveUserId)', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, scope_type: 'portafolio_viajes' }),
    });
    expect(res.status).toBe(403);
    // Exactamente 1 SELECT: resolveUserId. El branch portafolio NO consulta
    // memberships ni viajes (superficie cero — O-1b).
    expect(db.__selectCount()).toBe(1);
  });

  // ── No-regresión (deben seguir verdes tras adaptar stubs) ───────────────

  it('expires_at en el pasado → 400 expires_at_must_be_future', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ id: 'm1' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, expires_at: '2020-01-01T00:00:00Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza data_categories vacío con 400 (zod validator)', async () => {
    const db = makeDbStub({});
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, data_categories: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza consent_document_url no-HTTPS con 400 (zod refine)', async () => {
    const db = makeDbStub({});
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, consent_document_url: 'http://insecure.test/c.pdf' }),
    });
    expect(res.status).toBe(400);
  });

  // ── Evidencia 21.719 (columnas nuevas) ──────────────────────────────────

  it('caso 16: grant exitoso persiste noticeVersion/grantIp/grantUserAgent', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ id: 'm1' }]],
      inserts: [[{ id: 'new-consent-uuid' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
        'x-forwarded-for': '1.1.1.1, 2.2.2.2',
        'user-agent': 'BoosterTest/1.0',
      },
      body: JSON.stringify({ ...validBody, notice_version: 'esg-v1' }),
    });
    expect(res.status).toBe(201);
    const inserted = db.__insertValues[0] as {
      noticeVersion?: string | null;
      grantIp?: string | null;
      grantUserAgent?: string | null;
    };
    // extractClientIp con 2 entries devuelve la penúltima.
    expect(inserted.grantIp).toBe('1.1.1.1');
    expect(inserted.grantUserAgent).toBe('BoosterTest/1.0');
    expect(inserted.noticeVersion).toBe('esg-v1');
  });

  it('caso 17: grant sin XFF / sin user-agent persiste nulls (no rompe)', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ id: 'm1' }]],
      inserts: [[{ id: 'new-consent-uuid' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const inserted = db.__insertValues[0] as {
      noticeVersion?: string | null;
      grantIp?: string | null;
      grantUserAgent?: string | null;
    };
    expect(inserted.grantIp).toBeNull();
    // hono/undici puede setear un user-agent por defecto en el request de test;
    // lo importante es que noticeVersion ausente → null.
    expect(inserted.noticeVersion).toBeNull();
  });
});

describe('PATCH /me/consents/:id/revoke', () => {
  it('GAP-1: :id no-UUID → 400 invalid_consent_id (Zod en boundary, antes de la BD)', async () => {
    const db = makeDbStub({ selects: [[{ id: USER_ID }]] });
    const app = await buildApp(db);
    const res = await app.request('/me/consents/not-a-uuid/revoke', {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_consent_id');
    // Solo resolveUserId tocó la BD; el :id inválido cortó antes del pre-check.
    expect(db.__selectCount()).toBe(1);
  });

  it('user no registrado → 404 user_not_registered', async () => {
    const db = makeDbStub({ selects: [[]] });
    const app = await buildApp(db);
    const res = await app.request(`/me/consents/${VALID_CONSENT_ID}/revoke`, {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(404);
  });

  it('consent inexistente → 404 consent_not_found', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }], // resolveUserId
        [], // consent SELECT pre-check
      ],
    });
    const app = await buildApp(db);
    const res = await app.request(`/me/consents/${VALID_CONSENT_ID}/revoke`, {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('consent_not_found');
  });

  it('consent existe pero de otro otorgante → 403 forbidden_not_grantor', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ grantedByUserId: 'OTRO-USER' }]],
    });
    const app = await buildApp(db);
    const res = await app.request(`/me/consents/${VALID_CONSENT_ID}/revoke`, {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_not_grantor');
  });

  it('happy path: revocación exitosa → 200 { revoked: true }', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ grantedByUserId: USER_ID }]],
      updates: [[{ id: 'c1' }]],
    });
    const app = await buildApp(db);
    const res = await app.request(`/me/consents/${VALID_CONSENT_ID}/revoke`, {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revoked: boolean };
    expect(body.revoked).toBe(true);
  });

  it('idempotente: ya revocado → 200 { already_revoked: true }', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [{ grantedByUserId: USER_ID }],
        [{ grantedByUserId: USER_ID, revokedAt: new Date() }], // service revokeConsent's second SELECT
      ],
      updates: [[]], // UPDATE no afecta filas (ya revocado)
    });
    const app = await buildApp(db);
    const res = await app.request(`/me/consents/${VALID_CONSENT_ID}/revoke`, {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { already_revoked?: boolean };
    expect(body.already_revoked).toBe(true);
  });
});

describe('GET /me/consents', () => {
  it('user no registrado → 404', async () => {
    const db = makeDbStub({ selects: [[]] });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(404);
  });

  it('lista consents activos por default', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [
          {
            id: 'c1',
            stakeholderId: 'stk1',
            stakeholderOrgName: 'Walmart Chile S.A.',
            scopeType: 'organizacion',
            scopeId: 'emp1',
            dataCategories: ['emisiones_carbono'],
            grantedAt: new Date('2026-01-01'),
            expiresAt: null,
            revokedAt: null,
          },
        ],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { consents: unknown[] };
    expect(body.consents).toHaveLength(1);
  });

  it('include_inactive=true incluye revocados', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [
          {
            id: 'c1',
            stakeholderId: 'stk1',
            stakeholderOrgName: 'Org',
            scopeType: 'organizacion',
            scopeId: 'emp1',
            dataCategories: ['rutas'],
            grantedAt: new Date('2026-01-01'),
            expiresAt: null,
            revokedAt: new Date('2026-04-01'),
          },
        ],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents?include_inactive=true', {
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { consents: { revoked_at: string | null }[] };
    expect(body.consents[0]?.revoked_at).not.toBeNull();
  });
});
