import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /admin/stakeholder-orgs/:id/invitar — el vínculo de persona
 * (`.specs/aislamiento-vinculo-persona/spec.md`) aplicado a organizaciones
 * stakeholder: una cuenta viva o un placeholder con código no reciben un
 * código nuevo; solo la persona nueva o la provisoria sin código.
 */

const ADMIN_EMAIL = 'dev@boosterchile.com';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const RUT = '12345678-5';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never as Logger;

function org() {
  return { id: ORG_ID, deletedAt: null };
}

function usuario(over: Record<string, unknown>) {
  return {
    id: 'u-existente',
    email: 'persona@acme.cl',
    firebaseUid: 'fb-real',
    claveNumericaHash: null,
    activationPinHash: null,
    ...over,
  };
}

function makeDb(selects: unknown[][], returning: unknown[][]) {
  const selectQueue = [...selects];
  const returningQueue = [...returning];
  const inserted: Array<Record<string, unknown>> = [];
  const sets: Array<Record<string, unknown>> = [];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => selectQueue.shift() ?? []);
    return chain;
  });
  const insert = vi.fn(() => ({
    values: vi.fn((vals: Record<string, unknown>) => {
      inserted.push(vals);
      return { returning: vi.fn(async () => returningQueue.shift() ?? []) };
    }),
  }));
  const update = vi.fn(() => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      sets.push(vals);
      return { where: vi.fn(async () => undefined) };
    }),
  }));
  return { db: { select, insert, update } as never, inserted, sets, update };
}

function buildApp(
  mod: typeof import('./admin-stakeholder-orgs.js'),
  db: ReturnType<typeof makeDb>['db'],
  email = ADMIN_EMAIL,
) {
  const routes = mod.createAdminStakeholderOrgsRoutes({ db, logger: noopLogger });
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
      user: { id: 'admin-id', email },
    });
    await next();
  });
  app.route('/', routes);
  return app;
}

async function loadMod() {
  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] },
  }));
  return import('./admin-stakeholder-orgs.js');
}

function invitar(app: Hono, email = 'persona@acme.cl') {
  return app.request(`/${ORG_ID}/invitar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rut: RUT, email, full_name: 'Persona Stakeholder' }),
  });
}

interface Respuesta {
  membership_id: string;
  user_id: string;
  status: string;
  codigo_activacion: string | null;
  expira_en: string | null;
  vinculo: string;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /admin/stakeholder-orgs/:id/invitar', () => {
  it('quien no es platform-admin recibe 403 y no se escribe nada', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()]], []);
    const res = await invitar(buildApp(mod, d.db, 'otro@empresa.cl'));
    expect(res.status).toBe(403);
    expect(d.inserted).toHaveLength(0);
  });

  it('organización inexistente o eliminada → 404', async () => {
    const mod = await loadMod();
    const d = makeDb([[]], []);
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(404);
    expect(d.inserted).toHaveLength(0);
  });

  it('persona nueva: crea el usuario con el código hasheado y membresía pendiente; devuelve el código', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [], []], [[{ id: 'u-nuevo' }], [{ id: 'm-1' }]]);
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('nueva');
    expect(body.status).toBe('pendiente_invitacion');
    expect(body.codigo_activacion).toMatch(/^\d{6}$/);
    expect(body.expira_en).toBeTruthy();
    expect(d.inserted[0]).toMatchObject({ rut: RUT, firebaseUid: `pending-rut:${RUT}` });
    expect(d.inserted[0]?.activationPinHash).toBeTruthy();
    expect(d.inserted[0]?.activationPinHash).not.toBe(body.codigo_activacion);
    expect(d.inserted[1]).toMatchObject({
      userId: 'u-nuevo',
      empresaId: null,
      organizacionStakeholderId: ORG_ID,
      role: 'stakeholder_sostenibilidad',
      status: 'pendiente_invitacion',
      invitedByUserId: 'admin-id',
    });
  });

  it('cuenta viva: membresía activa, sin código, y no toca al usuario', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[org()], [usuario({ claveNumericaHash: 'hash-clave' })], []],
      [[{ id: 'm-1' }]],
    );
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('cuenta_activa');
    expect(body.status).toBe('activa');
    expect(body.codigo_activacion).toBeNull();
    expect(body.expira_en).toBeNull();
    expect(d.update).not.toHaveBeenCalled();
    expect(d.inserted).toHaveLength(1);
    expect(d.inserted[0]).toMatchObject({ userId: 'u-existente', status: 'activa' });
  });

  it('provisoria con código vigente: no emite otro ni reescribe el hash', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [
        [org()],
        [usuario({ firebaseUid: `pending-rut:${RUT}`, activationPinHash: 'hash-pin' })],
        [],
      ],
      [[{ id: 'm-1' }]],
    );
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('codigo_vigente');
    expect(body.codigo_activacion).toBeNull();
    expect(body.status).toBe('pendiente_invitacion');
    expect(d.update).not.toHaveBeenCalled();
  });

  it('provisoria sin código: emite el primero y lo guarda hasheado', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[org()], [usuario({ firebaseUid: `pending-rut:${RUT}` })], []],
      [[{ id: 'm-1' }]],
    );
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('provisoria_sin_codigo');
    expect(body.codigo_activacion).toMatch(/^\d{6}$/);
    expect(d.sets[0]?.activationPinHash).toBeTruthy();
    expect(d.sets[0]?.activationPinHash).not.toBe(body.codigo_activacion);
  });

  it('ya miembro de la organización → 409 y no se escribe', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [usuario({ claveNumericaHash: 'hash' })], [{ id: 'm-0' }]], []);
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'already_member', membership_id: 'm-0' });
    expect(d.inserted).toHaveLength(0);
  });
});
