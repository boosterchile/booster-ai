import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { createAdminDispositivosRoutes } from './admin-dispositivos.js';

/**
 * La empresa no lista la bandeja global de Teltonika. Tiene que traer el
 * IMEI impreso en el equipo. Rechazar un pending ajeno queda fuera de
 * este panel.
 */

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Logger;

const IMEI = '356307042441013';

function deviceRow() {
  return {
    id: 'd1',
    imei: IMEI,
    firstConnectionAt: new Date('2026-05-10T10:00:00Z'),
    lastConnectionAt: new Date('2026-05-10T10:05:00Z'),
    lastSourceIp: '1.2.3.4',
    connectionCount: 3,
    detectedModel: 'FMC150',
    status: 'pendiente',
    assignedToVehicleId: null,
    assignedAt: null,
    notes: null,
  };
}

function containsImei(value: unknown, imei: string, seen = new Set<unknown>()): boolean {
  if (typeof value === 'string') {
    return value.includes(imei);
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsImei(item, imei, seen));
  }
  return Object.values(value).some((item) => containsImei(item, imei, seen));
}

function makeDb(rows: unknown[]) {
  const whereArgs: unknown[] = [];
  const limit = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn((clause: unknown) => {
    whereArgs.push(clause);
    return { orderBy, limit };
  });
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'd1', imei: IMEI }]),
      })),
    })),
  }));
  return {
    db: { select, update, transaction: vi.fn() } as unknown as Db,
    whereArgs,
    update,
  };
}

function makeApp(db: Db, role: 'dueno' | 'admin' | 'conductor' | null = 'dueno') {
  const routes = createAdminDispositivosRoutes({ db, logger: noopLogger });
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (role) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'user-1' },
        activeMembership: {
          membership: { role },
          empresa: { id: 'emp-1' },
        },
      });
    }
    await next();
  });
  app.route('/', routes);
  return app;
}

describe('GET /admin/dispositivos-pendientes', () => {
  it('sin imei → 400', async () => {
    const { db } = makeDb([deviceRow()]);
    const res = await makeApp(db).request('/?estado=pendiente');
    expect(res.status).toBe(400);
  });

  it('imei mal formado → 400', async () => {
    const { db } = makeDb([deviceRow()]);
    const res = await makeApp(db).request('/?imei=111222333');
    expect(res.status).toBe(400);
  });

  it('con el IMEI devuelve esa fila y omite la IP', async () => {
    const { db, whereArgs } = makeDb([deviceRow()]);
    const res = await makeApp(db).request(`/?imei=${IMEI}&estado=pendiente`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { devices: Array<Record<string, unknown>> };
    expect(json.devices).toHaveLength(1);
    expect(json.devices[0]?.imei).toBe(IMEI);
    expect(json.devices[0]).not.toHaveProperty('ultima_ip_origen');
    expect(whereArgs.some((clause) => containsImei(clause, IMEI))).toBe(true);
  });

  it('IMEI que no está pendiente → lista vacía', async () => {
    const { db } = makeDb([]);
    const res = await makeApp(db).request(`/?imei=${IMEI}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { devices: unknown[] };
    expect(json.devices).toEqual([]);
  });
});

describe('POST /admin/dispositivos-pendientes/:id/rechazar', () => {
  it('un admin de empresa recibe 403 y no escribe', async () => {
    const { db, update } = makeDb([deviceRow()]);
    const res = await makeApp(db, 'admin').request('/d1/rechazar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('platform_admin_required');
    expect(update).not.toHaveBeenCalled();
  });
});
