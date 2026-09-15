import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// Slot 3, paso 4 (conductor-vista-ruta-resultado): el conductor asignado lee el
// resultado del viaje y descarga su certificado. Los endpoints equivalentes de
// trip-requests-v2 están acotados al generador → el conductor recibía 404.
vi.mock('../../src/services/confirmar-entrega-viaje.js', () => ({
  confirmarEntregaViaje: vi.fn(),
}));
vi.mock('../../src/services/confirmar-recogida-viaje.js', () => ({
  confirmarRecogidaViaje: vi.fn(),
}));
const { counterSpies } = vi.hoisted(() => ({
  counterSpies: new Map<string, { add: ReturnType<typeof vi.fn> }>(),
}));
vi.mock('../../src/observability/business-metrics.js', () => ({
  getBusinessCounter: vi.fn((name: string) => {
    let counter = counterSpies.get(name);
    if (!counter) {
      counter = { add: vi.fn() };
      counterSpies.set(name, counter);
    }
    return counter;
  }),
}));
vi.mock('../../src/observability/business-span.js', () => ({
  withBusinessSpan: vi.fn(
    async (_opts: unknown, fn: (span: { setAttributes: () => void }) => Promise<unknown>) =>
      fn({ setAttributes: vi.fn() }),
  ),
  setResultAttributes: vi.fn(),
}));
const signedUrlSpy = vi.fn(async () => 'https://storage.example/signed/BOO-BKAXIK.pdf');
vi.mock('@booster-ai/certificate-generator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@booster-ai/certificate-generator')>();
  return { ...actual, generarSignedUrlPdf: (...a: unknown[]) => signedUrlSpy(...a) };
});

const noop = () => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as never;

function makeDb(selects: unknown[][]) {
  const queue = [...selects];
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => queue.shift() ?? []),
    then: (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? []),
  };
  return { select: vi.fn(() => chain) };
}

const ASSIGNMENT_ID = 'assign-uuid-1';
const TRIP_ID = 'trip-uuid-1';
const CARRIER_EMP = 'carrier-emp';
const SHIPPER_EMP = 'shipper-emp';
const DRIVER_USER = 'user-driver';

function ctx(userId: string, role: string, empresaId = CARRIER_EMP) {
  return JSON.stringify({
    user: { id: userId },
    activeMembership: {
      membership: { role },
      empresa: { id: empresaId, isTransportista: true, status: 'activa' },
    },
  });
}

const ROW = {
  assignmentId: ASSIGNMENT_ID,
  assignmentStatus: 'entregado',
  driverUserId: DRIVER_USER,
  empresaId: CARRIER_EMP,
  pickedUpAt: new Date('2026-09-14T16:44:36Z'),
  deliveredAt: new Date('2026-09-14T17:01:57Z'),
  tripId: TRIP_ID,
  trackingCode: 'BOO-BKAXIK',
  generadorEmpresaId: SHIPPER_EMP,
  distanceKmEstimated: '500.00',
  distanceKmActual: '2.51',
  carbonEmissionsKgco2eEstimated: '33.475',
  carbonEmissionsKgco2eActual: '2.691',
  precisionMethod: 'modelado',
  glecVersion: '3.0',
  routeDataSource: 'teltonika_gps',
  coveragePct: '100.00',
  certificationLevel: 'secundario_modeled',
  certificatePdfUrl: 'gs://bucket/certificates/shipper-emp/BOO-BKAXIK.pdf',
  certificateSha256: 'e5572af9718267f0',
  certificateKmsKeyVersion: '1',
  certificateIssuedAt: new Date('2026-09-14T21:40:40Z'),
  metricsTripId: TRIP_ID,
};

async function buildApp(db: unknown, certConfig?: unknown) {
  const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    const h = c.req.header('x-test-userctx');
    if (h) {
      c.set('userContext', JSON.parse(h));
    }
    await next();
  });
  app.route(
    '/assignments',
    createAssignmentsRoutes({
      db: db as never,
      logger: noopLogger,
      certConfig: certConfig as never,
      geofenceRadiusM: 150,
    }),
  );
  return app;
}

describe('GET /assignments/:id/resultado', () => {
  it('sin userContext → 401', async () => {
    const app = await buildApp(makeDb([[ROW]]));
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/resultado`);
    expect(res.status).toBe(401);
  });

  it('conductor asignado → 200 con métricas, línea de método y certificado', async () => {
    const app = await buildApp(makeDb([[ROW]]));
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/resultado`, {
      headers: { 'x-test-userctx': ctx(DRIVER_USER, 'conductor') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.trip).toEqual({ id: TRIP_ID, tracking_code: 'BOO-BKAXIK' });
    expect(body.assignment.status).toBe('entregado');
    expect(body.metrics.carbon_emissions_kgco2e_actual).toBe('2.691');
    expect(body.metrics.linea_metodo).toMatch(/GPS del vehículo/);
    expect(body.certificate).toEqual(
      expect.objectContaining({
        sha256: 'e5572af9718267f0',
        verify_url: expect.stringContaining('/certificates/BOO-BKAXIK/verify'),
      }),
    );
    // Nunca precios en la pantalla del conductor.
    expect(JSON.stringify(body)).not.toMatch(/price|precio/);
  });

  it('otro conductor de la misma empresa (sin escritura) → 403', async () => {
    const app = await buildApp(makeDb([[ROW]]));
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/resultado`, {
      headers: { 'x-test-userctx': ctx('otro-user', 'conductor') },
    });
    expect(res.status).toBe(403);
  });

  it('despachador de la transportista → 200 (escritura); de otra empresa → 403', async () => {
    const ok = await (await buildApp(makeDb([[ROW]]))).request(
      `/assignments/${ASSIGNMENT_ID}/resultado`,
      {
        headers: { 'x-test-userctx': ctx('jefe', 'despachador') },
      },
    );
    expect(ok.status).toBe(200);
    const ajeno = await (await buildApp(makeDb([[ROW]]))).request(
      `/assignments/${ASSIGNMENT_ID}/resultado`,
      {
        headers: { 'x-test-userctx': ctx('jefe', 'despachador', 'otra-emp') },
      },
    );
    expect(ajeno.status).toBe(403);
  });

  it('sin métricas ni certificado aún → metrics null, certificate null', async () => {
    const sinMetricas = {
      ...ROW,
      metricsTripId: null,
      carbonEmissionsKgco2eActual: null,
      certificateIssuedAt: null,
      certificatePdfUrl: null,
    };
    const app = await buildApp(makeDb([[sinMetricas]]));
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/resultado`, {
      headers: { 'x-test-userctx': ctx(DRIVER_USER, 'conductor') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.metrics).toBeNull();
    expect(body.certificate).toBeNull();
  });

  it('asignación inexistente → 404', async () => {
    const app = await buildApp(makeDb([[]]));
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/resultado`, {
      headers: { 'x-test-userctx': ctx(DRIVER_USER, 'conductor') },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /assignments/:id/certificate/download', () => {
  const certConfig = {
    certificatesBucket: 'bucket-prod',
    kmsKeyId: 'k',
    verifyBaseUrl: 'https://api.boosterchile.com',
  };

  it('conductor asignado → signed URL (5 min) sobre la ruta del generador', async () => {
    signedUrlSpy.mockClear();
    const app = await buildApp(makeDb([[ROW]]), certConfig);
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/certificate/download`, {
      headers: { 'x-test-userctx': ctx(DRIVER_USER, 'conductor') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      download_url: 'https://storage.example/signed/BOO-BKAXIK.pdf',
      expires_in_seconds: 300,
      tracking_code: 'BOO-BKAXIK',
    });
    expect(signedUrlSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'bucket-prod',
        empresaId: SHIPPER_EMP,
        trackingCode: 'BOO-BKAXIK',
        ttlSeconds: 300,
      }),
    );
  });

  it('certificado aún no emitido → 404 certificate_not_issued', async () => {
    const app = await buildApp(
      makeDb([[{ ...ROW, certificateIssuedAt: null, certificatePdfUrl: null }]]),
      certConfig,
    );
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/certificate/download`, {
      headers: { 'x-test-userctx': ctx(DRIVER_USER, 'conductor') },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('certificate_not_issued');
  });

  it('sin bucket configurado → 503 certificates_disabled', async () => {
    const app = await buildApp(makeDb([[ROW]]), undefined);
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/certificate/download`, {
      headers: { 'x-test-userctx': ctx(DRIVER_USER, 'conductor') },
    });
    expect(res.status).toBe(503);
  });

  it('usuario ajeno → 403', async () => {
    const app = await buildApp(makeDb([[ROW]]), certConfig);
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/certificate/download`, {
      headers: { 'x-test-userctx': ctx('otro-user', 'conductor') },
    });
    expect(res.status).toBe(403);
  });
});
