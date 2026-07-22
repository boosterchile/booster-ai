import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noop = () => undefined;
const noopLogger = {
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

/**
 * Stub por colas: cada query consume el siguiente array de `selects`. La query
 * del assignment termina en `.limit()`; la de puntos en `.orderBy()`. Ambas son
 * terminales (comparten `term`), así que el orden de la cola = orden de queries
 * (primero el join del assignment, luego los puntos).
 */
function makeDb(selects: unknown[][]) {
  const queue = [...selects];
  const term = vi.fn(async () => queue.shift() ?? []);
  const buildChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: term,
      limit: term,
    };
    return chain;
  };
  return { select: vi.fn(() => buildChain()) };
}

async function buildApp(db: unknown) {
  const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');
  const app = new Hono();
  app.use('/assignments/*', async (c, next) => {
    const h = c.req.header('x-test-userctx');
    if (h) {
      c.set('userContext', JSON.parse(h));
    }
    await next();
  });
  app.route('/assignments', createAssignmentsRoutes({ db: db as never, logger: noopLogger }));
  return app;
}

const ASSIGNMENT_ID = 'assign-1';
const VALID_CTX = JSON.stringify({
  user: { id: 'u' },
  activeMembership: { empresa: { id: 'carrier-emp', isTransportista: true, status: 'activa' } },
});

const assignmentRow = {
  vehicleId: 'veh-1',
  plate: 'PLFL57',
  tripId: 'trip-1',
  pickup: new Date('2026-07-14T10:00:00Z'),
  delivered: new Date('2026-07-20T18:00:00Z'),
  polyline: 'abc123poly',
  distanciaEstimada: '5.00',
};

const pt = (iso: string, lat: string, lng: string, io: Record<string, number> = {}) => ({
  ts: new Date(iso),
  lat,
  lng,
  io,
});

interface TrazaCargaBody {
  plate: string;
  delivered: boolean;
  puntos: Array<{ t: string; lat: number; lng: number }>;
  puntos_total: number;
  puntos_devueltos: number;
  ruta_esperada_polyline: string | null;
  resumen: {
    distancia_real_km: number;
    distancia_esperada_km: number | null;
    duracion_min: number;
    cobertura_pct: number | null;
    litros_consumidos: number | null;
    km_can: number | null;
  };
}

function req(app: Hono, extra = '') {
  return app.request(`/assignments/${ASSIGNMENT_ID}/traza${extra}`, {
    headers: { 'x-test-userctx': VALID_CTX },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /assignments/:id/traza (historial de carga, capa 2)', () => {
  it('sin userContext → 401', async () => {
    const app = await buildApp(makeDb([]));
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/traza`);
    expect(res.status).toBe(401);
  });

  it('assignment no encontrado → 404', async () => {
    const app = await buildApp(makeDb([[]])); // join devuelve []
    const res = await req(app);
    expect(res.status).toBe(404);
  });

  it('con telemetría + CAN + ruta esperada → traza + resumen (real/esperada/cobertura/CAN)', async () => {
    const points = [
      pt('2026-07-14T10:00:00Z', '-33.4000', '-70.6000', { '83': 637270, '87': 714023430 }),
      pt('2026-07-14T10:00:30Z', '-33.4050', '-70.6000', {}), // +30s, sin CAN
      pt('2026-07-14T10:00:55Z', '-33.4100', '-70.6000', { '83': 641185, '87': 715017215 }), // +25s
    ];
    const app = await buildApp(makeDb([[assignmentRow], points]));
    const res = await req(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrazaCargaBody;
    expect(body.plate).toBe('PLFL57');
    expect(body.delivered).toBe(true);
    expect(body.ruta_esperada_polyline).toBe('abc123poly');
    expect(body.puntos_total).toBe(3);
    expect(body.resumen.distancia_esperada_km).toBe(5);
    expect(body.resumen.distancia_real_km).toBeGreaterThan(0);
    expect(body.resumen.litros_consumidos).toBeCloseTo(391.5, 1);
    expect(body.resumen.km_can).toBeCloseTo(993.785, 2);
    // Gaps < 60s → cobertura no-null (real vs esperada 5 km).
    expect(typeof body.resumen.cobertura_pct).toBe('number');
    expect(body.resumen.cobertura_pct).toBeGreaterThan(0);
  });

  it('sin telemetría → puntos [], cobertura/CAN null, no rompe', async () => {
    const app = await buildApp(makeDb([[assignmentRow], []]));
    const res = await req(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrazaCargaBody;
    expect(body.puntos).toEqual([]);
    expect(body.puntos_total).toBe(0);
    expect(body.resumen.distancia_real_km).toBe(0);
    expect(body.resumen.cobertura_pct).toBeNull(); // < 2 puntos
    expect(body.resumen.litros_consumidos).toBeNull();
    // La ruta esperada se sigue exponiendo aunque no haya traza.
    expect(body.ruta_esperada_polyline).toBe('abc123poly');
  });

  it('downsampling: puntos_devueltos ≤ maxPuntos y puntos_total = crudos', async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      pt(new Date(Date.UTC(2026, 6, 15, 12, 0, i)).toISOString(), `-33.${400 + i}`, '-70.6000'),
    );
    const app = await buildApp(makeDb([[assignmentRow], many]));
    const res = await req(app, '?maxPuntos=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrazaCargaBody;
    expect(body.puntos_total).toBe(50);
    expect(body.puntos_devueltos).toBeLessThanOrEqual(10);
  });
});
