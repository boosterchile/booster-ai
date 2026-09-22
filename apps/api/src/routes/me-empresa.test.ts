import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeEmpresaRoutes } from './me-empresa.js';

/**
 * Opt-in de huella a nivel empresa — `GET|PATCH /me/empresa`.
 *
 * El flag `empresas.carbon_measurement_enabled` ya existe (migr 0046) y el
 * cómputo post-entrega lo respeta. Este boundary es lo que falta para que un
 * dueño/admin lo active sin SQL. El `empresa_id` sale de la membresía activa,
 * nunca del cliente.
 */

const EMPRESA = 'e0000000-0000-4000-8000-000000000001';
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

interface EmpresaRow {
  id: string;
  legalName: string;
  carbonMeasurementEnabled: boolean;
  umbralRoboGolpeL?: number | null;
  umbralRoboHormigaL?: number | null;
}

interface DbOpts {
  selectRows?: EmpresaRow[];
  updated?: EmpresaRow[];
}

function makeDb(opts: DbOpts = {}) {
  const updates: Record<string, unknown>[] = [];
  const selectRows =
    opts.selectRows ??
    ([
      {
        id: EMPRESA,
        legalName: 'Transportes Demo',
        carbonMeasurementEnabled: false,
      },
    ] satisfies EmpresaRow[]);

  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => selectRows);
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(selectRows));
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => selectChain()),
      update: vi.fn(() => ({
        set: vi.fn((v: Record<string, unknown>) => {
          updates.push(v);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => {
                if (opts.updated) {
                  return opts.updated;
                }
                const current = selectRows[0];
                if (!current) {
                  return [];
                }
                return [
                  {
                    ...current,
                    carbonMeasurementEnabled:
                      typeof v.carbonMeasurementEnabled === 'boolean'
                        ? v.carbonMeasurementEnabled
                        : current.carbonMeasurementEnabled,
                    umbralRoboGolpeL:
                      'umbralRoboGolpeL' in v ? v.umbralRoboGolpeL : current.umbralRoboGolpeL,
                    umbralRoboHormigaL:
                      'umbralRoboHormigaL' in v ? v.umbralRoboHormigaL : current.umbralRoboHormigaL,
                  },
                ];
              }),
            })),
          };
        }),
      })),
    } as never,
    updates,
  };
}

function buildApp(
  db: ReturnType<typeof makeDb>['db'],
  ctx: {
    empresaId?: string | null;
    rol?: string;
    noMembership?: boolean;
    noUser?: boolean;
    noEmpresaId?: boolean;
  } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (ctx.noUser) {
      await next();
      return;
    }
    const empresaId = ctx.noEmpresaId
      ? null
      : ctx.empresaId === undefined
        ? EMPRESA
        : ctx.empresaId;
    (c as unknown as { set: (k: string, v: unknown) => void }).set(
      'userContext',
      ctx.noMembership
        ? { user: { id: 'caller-id', email: 'jefe@empresa.cl' }, activeMembership: null }
        : {
            user: { id: 'caller-id', email: 'jefe@empresa.cl' },
            activeMembership: {
              membership: {
                id: 'membership-caller',
                empresaId,
                role: ctx.rol ?? 'dueno',
                status: 'activa',
              },
              empresa: {
                id: empresaId ?? EMPRESA,
                status: 'activa',
                legalName: 'Transportes Demo',
                carbonMeasurementEnabled: false,
              },
            },
          },
    );
    await next();
  });
  app.route('/', createMeEmpresaRoutes({ db, logger: noopLogger }));
  return app;
}

function patch(app: Hono, body: unknown) {
  return app.request('/', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /me/empresa', () => {
  it('devuelve el flag de la empresa activa, no un default inventado', async () => {
    const d = makeDb({
      selectRows: [{ id: EMPRESA, legalName: 'Transportes Demo', carbonMeasurementEnabled: true }],
    });
    const res = await buildApp(d.db).request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      id: string;
      legal_name: string;
      carbon_measurement_enabled: boolean;
    };
    expect(json.id).toBe(EMPRESA);
    expect(json.legal_name).toBe('Transportes Demo');
    expect(json.carbon_measurement_enabled).toBe(true);
  });

  it('403 sin membresía activa', async () => {
    const d = makeDb();
    const res = await buildApp(d.db, { noMembership: true }).request('/', { method: 'GET' });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('no_active_empresa');
  });

  it('403 admin_required si el rol no es dueno|admin', async () => {
    const d = makeDb();
    const res = await buildApp(d.db, { rol: 'despachador' }).request('/', { method: 'GET' });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('admin_required');
  });

  it('404 si la empresa de la membresía ya no existe', async () => {
    const d = makeDb({ selectRows: [] });
    const res = await buildApp(d.db).request('/', { method: 'GET' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('empresa_not_found');
  });
});

describe('PATCH /me/empresa', () => {
  it('activa carbon_measurement_enabled en la empresa de la membresía', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db), { carbon_measurement_enabled: true });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      id: string;
      carbon_measurement_enabled: boolean;
      carbon_measurement_enabled_anterior: boolean;
      unchanged: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.id).toBe(EMPRESA);
    expect(json.carbon_measurement_enabled).toBe(true);
    expect(json.carbon_measurement_enabled_anterior).toBe(false);
    expect(json.unchanged).toBe(false);
    expect(d.updates[0]).toEqual(expect.objectContaining({ carbonMeasurementEnabled: true }));
  });

  it('desactiva el flag', async () => {
    const d = makeDb({
      selectRows: [{ id: EMPRESA, legalName: 'Transportes Demo', carbonMeasurementEnabled: true }],
    });
    const res = await patch(buildApp(d.db), { carbon_measurement_enabled: false });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      carbon_measurement_enabled: boolean;
      carbon_measurement_enabled_anterior: boolean;
      unchanged: boolean;
    };
    expect(json.carbon_measurement_enabled).toBe(false);
    expect(json.carbon_measurement_enabled_anterior).toBe(true);
    expect(json.unchanged).toBe(false);
    expect(d.updates[0]).toEqual(expect.objectContaining({ carbonMeasurementEnabled: false }));
  });

  it('idempotente: mismo valor → 200 unchanged, sin write', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db), { carbon_measurement_enabled: false });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { unchanged: boolean; carbon_measurement_enabled: boolean };
    expect(json.unchanged).toBe(true);
    expect(json.carbon_measurement_enabled).toBe(false);
    expect(d.updates).toHaveLength(0);
  });

  it('body sin boolean → 400 y no escribe', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db), { carbon_measurement_enabled: 'true' });
    expect(res.status).toBe(400);
    expect(d.updates).toHaveLength(0);
  });

  it('body vacío → 400', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db), {});
    expect(res.status).toBe(400);
    expect(d.updates).toHaveLength(0);
  });

  it('403 admin_required si el rol no es dueno|admin', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db, { rol: 'despachador' }), {
      carbon_measurement_enabled: true,
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('admin_required');
    expect(d.updates).toHaveLength(0);
  });

  it('403 admin_required para visualizador', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db, { rol: 'visualizador' }), {
      carbon_measurement_enabled: true,
    });
    expect(res.status).toBe(403);
    expect(d.updates).toHaveLength(0);
  });

  it('403 no_active_empresa sin membresía', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db, { noMembership: true }), {
      carbon_measurement_enabled: true,
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('no_active_empresa');
    expect(d.updates).toHaveLength(0);
  });

  it('403 no_es_empresa si la membresía no apunta a una empresa', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db, { noEmpresaId: true }), {
      carbon_measurement_enabled: true,
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('no_es_empresa');
    expect(d.updates).toHaveLength(0);
  });

  it('401 sin userContext', async () => {
    const d = makeDb();
    const res = await patch(buildApp(d.db, { noUser: true }), {
      carbon_measurement_enabled: true,
    });
    expect(res.status).toBe(401);
    expect(d.updates).toHaveLength(0);
  });

  it('404 si la empresa de la membresía ya no existe', async () => {
    const d = makeDb({ selectRows: [] });
    const res = await patch(buildApp(d.db), { carbon_measurement_enabled: true });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('empresa_not_found');
    expect(d.updates).toHaveLength(0);
  });
});

function patchUmbrales(app: Hono, body: unknown) {
  return app.request('/umbrales-combustible', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /me/empresa/umbrales-combustible', () => {
  it('persiste golpe y hormiga dentro de rango', async () => {
    const d = makeDb();
    const res = await patchUmbrales(buildApp(d.db), {
      umbral_robo_golpe_l: 5,
      umbral_robo_hormiga_l: 30,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      umbral_robo_golpe_l: number;
      umbral_robo_hormiga_l: number;
      unchanged: boolean;
    };
    expect(json.umbral_robo_golpe_l).toBe(5);
    expect(json.umbral_robo_hormiga_l).toBe(30);
    expect(json.unchanged).toBe(false);
    expect(d.updates[0]).toEqual(
      expect.objectContaining({ umbralRoboGolpeL: 5, umbralRoboHormigaL: 30 }),
    );
  });

  it('rechaza menos de 5 L, más de 20 L y hormiga fuera de 8–30', async () => {
    const d = makeDb();
    for (const body of [
      { umbral_robo_golpe_l: 4 },
      { umbral_robo_golpe_l: 21 },
      { umbral_robo_golpe_l: 5.5 },
      { umbral_robo_hormiga_l: 7 },
      { umbral_robo_hormiga_l: 31 },
      {},
    ]) {
      const res = await patchUmbrales(buildApp(d.db), body);
      expect(res.status).toBe(400);
    }
    expect(d.updates).toHaveLength(0);
  });

  it('null vuelve al default sin borrar el otro umbral', async () => {
    const d = makeDb({
      selectRows: [
        {
          id: EMPRESA,
          legalName: 'Transportes Demo',
          carbonMeasurementEnabled: false,
          umbralRoboGolpeL: 12,
          umbralRoboHormigaL: 15,
        },
      ],
    });
    const res = await patchUmbrales(buildApp(d.db), { umbral_robo_golpe_l: null });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      umbral_robo_golpe_l: number | null;
      umbral_robo_hormiga_l: number | null;
    };
    expect(json.umbral_robo_golpe_l).toBeNull();
    expect(json.umbral_robo_hormiga_l).toBe(15);
  });

  it('la authz sigue en dueno|admin: conductor, despachador y visualizador reciben 403', async () => {
    for (const rol of ['conductor', 'despachador', 'visualizador'] as const) {
      const d = makeDb();
      const res = await patchUmbrales(buildApp(d.db, { rol }), {
        umbral_robo_golpe_l: 8,
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('admin_required');
      expect(d.updates).toHaveLength(0);
    }
  });
});
