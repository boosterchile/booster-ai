import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { createSignupRequestRoutes } from './signup-request.js';

// T8 SEC-001 Sprint 2b — route tests POST /api/v1/signup-request (SC-1.2.1 +
// SC-1.2.5). Cubre: valid body → 202, invalid → 422, shadowed (email
// existente en users) → 202 idéntico (anti-enumeration), service throw → 503.

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Logger;

interface MakeDbOpts {
  existingUserRows?: Array<{ id: string }>;
  insertedId?: string;
  throwOnInsert?: Error;
  throwOnSelect?: Error;
}

function makeDb(opts: MakeDbOpts = {}) {
  const selectLimit = vi.fn(async () => {
    if (opts.throwOnSelect) {
      throw opts.throwOnSelect;
    }
    return opts.existingUserRows ?? [];
  });
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn(async () => {
    if (opts.throwOnInsert) {
      throw opts.throwOnInsert;
    }
    return [{ id: opts.insertedId ?? 'a1b2c3d4-1111-2222-3333-444455556666' }];
  });
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  type DbStub = Parameters<typeof createSignupRequestRoutes>[0]['db'];
  return {
    db: { select, insert } as unknown as DbStub,
    spies: { select, selectFrom, selectWhere, selectLimit, insert, insertValues, insertReturning },
  };
}

describe('POST /api/v1/signup-request (SC-1.2.1)', () => {
  it('valid body → 202 {ok:true} + INSERT en solicitudes_registro', async () => {
    const d = makeDb();
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ email: 'felipe@empresa.cl', nombreCompleto: 'Felipe Vicencio' }),
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(d.spies.select).toHaveBeenCalledTimes(1);
    expect(d.spies.insert).toHaveBeenCalledTimes(1);
    expect(d.spies.insertValues).toHaveBeenCalledWith({
      email: 'felipe@empresa.cl',
      nombreCompleto: 'Felipe Vicencio',
    });
  });

  it('shadow path (email ya en users) → 202 idéntico + NO INSERT (SC-1.2.5)', async () => {
    const d = makeDb({ existingUserRows: [{ id: 'user-existing-uuid' }] });
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'existente@cliente.cl', nombreCompleto: 'Existente' }),
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(d.spies.select).toHaveBeenCalledTimes(1);
    // CRITICAL anti-enumeration assertion: NO insert.
    expect(d.spies.insert).not.toHaveBeenCalled();
  });

  it('email lowercase-normalizado antes de SELECT + INSERT', async () => {
    const d = makeDb();
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'MiXeD@Case.CL', nombreCompleto: 'X' }),
    });
    expect(d.spies.insertValues).toHaveBeenCalledWith({
      email: 'mixed@case.cl',
      nombreCompleto: 'X',
    });
  });

  it('nombreCompleto trimmed', async () => {
    const d = makeDb();
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.cl', nombreCompleto: '  Felipe Vicencio  ' }),
    });
    expect(d.spies.insertValues).toHaveBeenCalledWith({
      email: 'a@b.cl',
      nombreCompleto: 'Felipe Vicencio',
    });
  });

  it('invalid email → 400 (zValidator)', async () => {
    const d = makeDb();
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', nombreCompleto: 'X' }),
    });
    expect(res.status).toBe(400);
    expect(d.spies.select).not.toHaveBeenCalled();
    expect(d.spies.insert).not.toHaveBeenCalled();
  });

  it('nombreCompleto vacío → 400 (zValidator min(1))', async () => {
    const d = makeDb();
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.cl', nombreCompleto: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('email > 320 chars → 400 (zValidator max(320))', async () => {
    const d = makeDb();
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    const longLocal = 'a'.repeat(320);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${longLocal}@x.cl`, nombreCompleto: 'X' }),
    });
    expect(res.status).toBe(400);
  });

  it('service throw (DB unreachable) → 503', async () => {
    const d = makeDb({ throwOnSelect: new Error('ECONNREFUSED') });
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.cl', nombreCompleto: 'X' }),
    });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBe('service_unavailable');
  });

  it('correlation_id header propagado a logger', async () => {
    const d = makeDb();
    const infoSpy = vi.fn();
    const logger = { ...noopLogger, info: infoSpy } as unknown as Logger;
    const app = createSignupRequestRoutes({ db: d.db, logger });

    await app.request('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': 'corr-test-123',
      },
      body: JSON.stringify({ email: 'a@b.cl', nombreCompleto: 'X' }),
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr-test-123', outcome: 'submitted' }),
      expect.any(String),
    );
  });

  it('sin correlation_id header: genera uuid (no falla)', async () => {
    const d = makeDb();
    const app = createSignupRequestRoutes({ db: d.db, logger: noopLogger });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.cl', nombreCompleto: 'X' }),
    });
    expect(res.status).toBe(202);
  });
});
