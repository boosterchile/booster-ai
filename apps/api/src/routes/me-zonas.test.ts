import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeZonasRoutes } from './me-zonas.js';

/**
 * CRUD /me/zonas — el matching no recibe candidatos si el transportista no
 * tiene una zona activa en la región de origen (romano). Hasta este PR las
 * zonas solo se insertaban por SQL seed.
 */

const EMPRESA = 'e0000000-0000-4000-8000-000000000001';
const OTRA = 'e0000000-0000-4000-8000-000000000002';
const ZONA_ID = 'a0000000-0000-4000-8000-000000000001';
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

const NOW = new Date('2026-09-21T12:00:00.000Z');

function zonaRow(over: Record<string, unknown> = {}) {
  return {
    id: ZONA_ID,
    empresaId: EMPRESA,
    regionCode: 'XIII',
    comunaCodes: null,
    zoneType: 'ambos',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

interface DbOpts {
  selectRows?: unknown[];
  inserted?: unknown[];
  updated?: unknown[];
}

function makeDb(opts: DbOpts = {}) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const selectRows = opts.selectRows ?? [];

  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(async () => selectRows);
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(selectRows));
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => selectChain()),
      insert: vi.fn(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          inserted.push(v);
          return {
            returning: vi.fn(async () => opts.inserted ?? [zonaRow(v)]),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((v: Record<string, unknown>) => {
          updates.push(v);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(
                async () => opts.updated ?? [zonaRow({ ...v, isActive: v.isActive })],
              ),
            })),
          };
        }),
      })),
    } as never,
    inserted,
    updates,
  };
}

function buildApp(
  db: ReturnType<typeof makeDb>['db'],
  ctx: {
    empresaId?: string | null;
    rol?: string;
    isTransportista?: boolean;
    noMembership?: boolean;
    noUser?: boolean;
  } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (ctx.noUser) {
      await next();
      return;
    }
    (c as unknown as { set: (k: string, v: unknown) => void }).set(
      'userContext',
      ctx.noMembership
        ? { user: { id: 'caller-id', email: 'jefe@empresa.cl' }, activeMembership: null }
        : {
            user: { id: 'caller-id', email: 'jefe@empresa.cl' },
            activeMembership: {
              membership: {
                id: 'membership-caller',
                empresaId: ctx.empresaId === undefined ? EMPRESA : ctx.empresaId,
                role: ctx.rol ?? 'dueno',
                status: 'activa',
              },
              empresa: {
                id: ctx.empresaId === undefined ? EMPRESA : ctx.empresaId,
                status: 'activa',
                isTransportista: ctx.isTransportista ?? true,
              },
            },
          },
    );
    await next();
  });
  app.route('/', createMeZonasRoutes({ db, logger: noopLogger }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /me/zonas', () => {
  it('crea zona XIII / ambos / activa — el shape que matching lee', async () => {
    const d = makeDb({ selectRows: [] });
    const res = await buildApp(d.db).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region_code: 'XIII', zone_type: 'ambos' }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      zona: { region_code: string; zone_type: string; is_active: boolean };
    };
    expect(json.zona.region_code).toBe('XIII');
    expect(json.zona.zone_type).toBe('ambos');
    expect(json.zona.is_active).toBe(true);
    expect(d.inserted[0]).toEqual(
      expect.objectContaining({
        empresaId: EMPRESA,
        regionCode: 'XIII',
        zoneType: 'ambos',
        isActive: true,
        comunaCodes: null,
      }),
    );
  });

  it('rechaza region_code arábigo (13) en el boundary de escritura', async () => {
    const d = makeDb();
    const res = await buildApp(d.db).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region_code: '13', zone_type: 'ambos' }),
    });

    expect(res.status).toBe(400);
    expect(d.inserted).toHaveLength(0);
  });

  it('403 si el rol no es dueno|admin', async () => {
    const d = makeDb();
    const res = await buildApp(d.db, { rol: 'despachador' }).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region_code: 'XIII', zone_type: 'recogida' }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('admin_required');
    expect(d.inserted).toHaveLength(0);
  });

  it('403 si la empresa no es transportista', async () => {
    const d = makeDb();
    const res = await buildApp(d.db, { isTransportista: false }).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region_code: 'XIII', zone_type: 'ambos' }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('not_a_carrier');
  });

  it('401 sin userContext', async () => {
    const d = makeDb();
    const res = await buildApp(d.db, { noUser: true }).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region_code: 'XIII', zone_type: 'ambos' }),
    });
    expect(res.status).toBe(401);
  });

  it('409 si ya existe la misma región+tipo', async () => {
    const d = makeDb({ selectRows: [{ id: ZONA_ID }] });
    const res = await buildApp(d.db).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region_code: 'XIII', zone_type: 'ambos' }),
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string; zona_id: string };
    expect(json.code).toBe('zona_duplicada');
    expect(json.zona_id).toBe(ZONA_ID);
    expect(d.inserted).toHaveLength(0);
  });
});

describe('GET /me/zonas', () => {
  it('lista las zonas de la empresa activa, no las ajenas', async () => {
    const d = makeDb({ selectRows: [zonaRow()] });
    const res = await buildApp(d.db).request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      zonas: Array<{ empresa_id: string; region_code: string }>;
    };
    expect(json.zonas).toHaveLength(1);
    expect(json.zonas[0]?.empresa_id).toBe(EMPRESA);
    expect(json.zonas[0]?.region_code).toBe('XIII');
  });

  it('403 sin membresía activa (otro tenant no se impersona por URL)', async () => {
    const d = makeDb();
    const res = await buildApp(d.db, { noMembership: true }).request('/', { method: 'GET' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /me/zonas/:id', () => {
  it('toggle es_activa', async () => {
    const d = makeDb({
      selectRows: [{ id: ZONA_ID }],
      updated: [zonaRow({ isActive: false })],
    });
    const res = await buildApp(d.db).request(`/${ZONA_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { zona: { is_active: boolean } };
    expect(json.zona.is_active).toBe(false);
    expect(d.updates[0]).toEqual(expect.objectContaining({ isActive: false }));
  });

  it('id de otra empresa → 404 (no filtramos existencia)', async () => {
    const d = makeDb({ selectRows: [] });
    const res = await buildApp(d.db, { empresaId: OTRA }).request(`/${ZONA_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });
    expect(res.status).toBe(404);
    expect(d.updates).toHaveLength(0);
  });
});

describe('DELETE /me/zonas/:id', () => {
  it('soft-deactivate: es_activa=false', async () => {
    const d = makeDb({ updated: [zonaRow({ isActive: false })] });
    const res = await buildApp(d.db).request(`/${ZONA_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(d.updates[0]).toEqual(expect.objectContaining({ isActive: false }));
  });

  it('id desconocido → 404', async () => {
    const d = makeDb({ updated: [] });
    const res = await buildApp(d.db).request(`/${ZONA_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
