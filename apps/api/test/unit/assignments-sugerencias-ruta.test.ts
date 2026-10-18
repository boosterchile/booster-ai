import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T10-23 — wiring HTTP del eco-routing en tiempo real. La lógica (detección,
 * Routes API, persistencia) está cubierta por el test de integración
 * `test/integration/eco-routing-tiempo-real.integration.test.ts`; acá se
 * prueban el disparo desde `driver-position` y los dos endpoints del conductor.
 */
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

vi.mock('../../src/services/eco-routing-tiempo-real.js', () => ({
  evaluarEcoRoutingAsignacion: vi.fn(async () => ({
    resultado: 'sin_congestion',
    razon: 'en_movimiento',
  })),
  obtenerSugerenciaRutaActiva: vi.fn(),
  registrarRespuestaSugerenciaRuta: vi.fn(),
}));

const eco = await import('../../src/services/eco-routing-tiempo-real.js');

const noop = (): void => undefined;
const errorSpy = vi.fn();
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: errorSpy,
  fatal: noop,
  child: () => logger,
} as never;

const ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';
const SUGERENCIA_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'driver-uuid';
const CTX = JSON.stringify({ user: { id: USER_ID } });

function makeDb(status: string) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => [
      {
        id: ASSIGNMENT_ID,
        driverUserId: USER_ID,
        vehicleId: 'veh',
        status,
        originLatitude: null,
        originLongitude: null,
      },
    ]),
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  };
}

async function buildApp(opts: { db: unknown; ecoRouting?: boolean }) {
  const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');
  const app = new Hono();
  app.use('/assignments/*', async (c, next) => {
    const h = c.req.header('x-test-userctx');
    if (h) {
      c.set('userContext', JSON.parse(h));
    }
    await next();
  });
  app.route(
    '/assignments',
    createAssignmentsRoutes({
      db: opts.db as never,
      logger,
      geofenceRadiusM: 150,
      ...(opts.ecoRouting
        ? {
            ecoRouting: {
              computeRoutes: vi.fn(),
              sendPush: vi.fn(),
              now: () => 0,
              throttle: new Map(),
            },
          }
        : {}),
    }),
  );
  return app;
}

const posicion = JSON.stringify({
  timestamp_device: '2026-10-08T15:00:00.000Z',
  latitude: -33.05,
  longitude: -71.4,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /assignments/:id/driver-position → eco-routing', () => {
  it('con el flag y el viaje recogido dispara la evaluación sin bloquear la respuesta', async () => {
    const app = await buildApp({ db: makeDb('recogido'), ecoRouting: true });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/driver-position`, {
      method: 'POST',
      headers: { 'x-test-userctx': CTX, 'content-type': 'application/json' },
      body: posicion,
    });
    expect(res.status).toBe(200);
    expect(eco.evaluarEcoRoutingAsignacion).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: ASSIGNMENT_ID, routesProjectId: undefined }),
    );
  });

  it('sin el flag no evalúa', async () => {
    const app = await buildApp({ db: makeDb('recogido') });
    await app.request(`/assignments/${ASSIGNMENT_ID}/driver-position`, {
      method: 'POST',
      headers: { 'x-test-userctx': CTX, 'content-type': 'application/json' },
      body: posicion,
    });
    expect(eco.evaluarEcoRoutingAsignacion).not.toHaveBeenCalled();
  });

  it('antes de la recogida (asignado) no evalúa', async () => {
    const app = await buildApp({ db: makeDb('asignado'), ecoRouting: true });
    await app.request(`/assignments/${ASSIGNMENT_ID}/driver-position`, {
      method: 'POST',
      headers: { 'x-test-userctx': CTX, 'content-type': 'application/json' },
      body: posicion,
    });
    expect(eco.evaluarEcoRoutingAsignacion).not.toHaveBeenCalled();
  });

  it('un fallo de la evaluación se loguea y no rompe el reporte de posición', async () => {
    vi.mocked(eco.evaluarEcoRoutingAsignacion).mockRejectedValueOnce(new Error('db caída'));
    const app = await buildApp({ db: makeDb('recogido'), ecoRouting: true });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/driver-position`, {
      method: 'POST',
      headers: { 'x-test-userctx': CTX, 'content-type': 'application/json' },
      body: posicion,
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});

describe('GET /assignments/:id/sugerencias-ruta/activa', () => {
  it('401 sin sesión', async () => {
    const app = await buildApp({ db: makeDb('recogido') });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/sugerencias-ruta/activa`);
    expect(res.status).toBe(401);
  });

  it('devuelve la sugerencia vigente del conductor en snake_case', async () => {
    vi.mocked(eco.obtenerSugerenciaRutaActiva).mockResolvedValueOnce({
      id: SUGERENCIA_ID,
      motivo: 'emisiones',
      polylineAlternativa: 'abc',
      ahorroSegundos: 300,
      ahorroKgco2e: 4.2,
      detectadaEn: new Date('2026-10-08T15:00:00Z'),
      texto: 'Hay una ruta alternativa: 5 min menos y 4,2 kg CO₂e menos.',
    });
    const app = await buildApp({ db: makeDb('recogido') });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/sugerencias-ruta/activa`, {
      headers: { 'x-test-userctx': CTX },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sugerencia: {
        id: SUGERENCIA_ID,
        motivo: 'emisiones',
        polyline_alternativa: 'abc',
        ahorro_segundos: 300,
        ahorro_kgco2e: 4.2,
        detectada_en: '2026-10-08T15:00:00.000Z',
        texto: 'Hay una ruta alternativa: 5 min menos y 4,2 kg CO₂e menos.',
      },
    });
    expect(eco.obtenerSugerenciaRutaActiva).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: ASSIGNMENT_ID, userId: USER_ID }),
    );
  });

  it('sin sugerencia vigente → { sugerencia: null }', async () => {
    vi.mocked(eco.obtenerSugerenciaRutaActiva).mockResolvedValueOnce(null);
    const app = await buildApp({ db: makeDb('recogido') });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/sugerencias-ruta/activa`, {
      headers: { 'x-test-userctx': CTX },
    });
    expect(await res.json()).toEqual({ sugerencia: null });
  });
});

describe('POST /assignments/:id/sugerencias-ruta/:sid/respuesta', () => {
  const url = `/assignments/${ASSIGNMENT_ID}/sugerencias-ruta/${SUGERENCIA_ID}/respuesta`;
  const post = (app: Hono, body: unknown, ctx: string | null = CTX) =>
    app.request(url, {
      method: 'POST',
      headers: { ...(ctx ? { 'x-test-userctx': ctx } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each([
    ['ok', 200],
    ['not_found', 404],
    ['forbidden', 403],
    ['ya_respondida', 409],
  ] as const)('resultado %s → %i', async (resultado, status) => {
    vi.mocked(eco.registrarRespuestaSugerenciaRuta).mockResolvedValueOnce(resultado);
    const app = await buildApp({ db: makeDb('recogido') });
    const res = await post(app, { respuesta: 'aceptada' });
    expect(res.status).toBe(status);
  });

  it('pasa la respuesta y el conductor al servicio', async () => {
    vi.mocked(eco.registrarRespuestaSugerenciaRuta).mockResolvedValueOnce('ok');
    const app = await buildApp({ db: makeDb('recogido') });
    await post(app, { respuesta: 'rechazada' });
    expect(eco.registrarRespuestaSugerenciaRuta).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: ASSIGNMENT_ID,
        sugerenciaId: SUGERENCIA_ID,
        userId: USER_ID,
        respuesta: 'rechazada',
      }),
    );
  });

  it('400 con respuesta inválida y 401 sin sesión', async () => {
    const app = await buildApp({ db: makeDb('recogido') });
    expect((await post(app, { respuesta: 'quizas' })).status).toBe(400);
    expect((await post(app, { respuesta: 'aceptada' }, null)).status).toBe(401);
  });
});
