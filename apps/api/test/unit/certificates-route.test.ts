import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

vi.mock('@booster-ai/certificate-generator', () => ({
  descargarSidecar: vi.fn(),
}));

const { descargarSidecar } = await import('@booster-ai/certificate-generator');

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

interface DbQueues {
  selects?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      offset: vi.fn(async () => selects.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve(selects.shift() ?? []));
    return chain;
  };

  return { select: vi.fn(() => buildSelectChain()) };
}

const SHIPPER_EMP = 'shipper-emp';
const VALID_CTX = JSON.stringify({
  user: { id: 'u' },
  activeMembership: {
    empresa: { id: SHIPPER_EMP, isGeneradorCarga: true, status: 'activa' },
  },
});

const VALID_CONFIG = {
  kmsKeyId: 'k',
  certificatesBucket: 'b',
  verifyBaseUrl: 'https://api.test',
};

async function buildApp(opts: { db: unknown; certConfig?: unknown }) {
  const { createCertificatesRoutes } = await import('../../src/routes/certificates.js');
  const app = new Hono();
  app.use('/certificates/*', async (c, next) => {
    const ctx = c.req.header('x-test-userctx');
    if (ctx) {
      c.set('userContext', JSON.parse(ctx));
    }
    await next();
  });
  app.route(
    '/certificates',
    createCertificatesRoutes({
      db: opts.db as never,
      logger: noopLogger,
      certConfig: opts.certConfig as never,
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

describe('GET /certificates (lista)', () => {
  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request('/certificates');
    expect(res.status).toBe(401);
  });

  it('sin activeMembership → 403 no_active_empresa', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request('/certificates', {
      headers: {
        'x-test-userctx': JSON.stringify({ user: { id: 'u' }, activeMembership: null }),
      },
    });
    expect(res.status).toBe(403);
  });

  it('empresa no es shipper → 403 not_a_shipper', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request('/certificates', {
      headers: {
        'x-test-userctx': JSON.stringify({
          user: { id: 'u' },
          activeMembership: {
            empresa: { id: 'e', isGeneradorCarga: false, status: 'activa' },
          },
        }),
      },
    });
    expect(res.status).toBe(403);
  });

  it('happy path: lista certificados con preferencia actual sobre estimated', async () => {
    const db = makeDb({
      selects: [
        [
          {
            tripId: 't1',
            trackingCode: 'BOO-A',
            originAddress: 'Stgo',
            destinationAddress: 'Vpo',
            cargoType: 'carga_seca',
            kgco2eEstimated: '40.0',
            kgco2eActual: '38.5',
            distanceKmEstimated: '120.0',
            distanceKmActual: '125.0',
            precisionMethod: 'modelado',
            glecVersion: 'v3.0',
            certificateSha256: 'sha-1',
            certificateKmsKeyVersion: '1',
            certificateIssuedAt: new Date('2026-05-09T12:00:00Z'),
          },
        ],
      ],
    });
    const app = await buildApp({ db });
    const res = await app.request('/certificates', {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      certificates: Array<{ kg_co2e: string; distance_km: string }>;
      pagination: { limit: number; offset: number };
    };
    expect(body.certificates[0]?.kg_co2e).toBe('38.5'); // actual gana
    expect(body.certificates[0]?.distance_km).toBe('125.0');
    expect(body.pagination.limit).toBe(50);
  });

  it('limit fuera de rango se clamps a [1, 100]', async () => {
    const db = makeDb({ selects: [[]] });
    const app = await buildApp({ db });
    const res = await app.request('/certificates?limit=500', {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pagination: { limit: number } };
    expect(body.pagination.limit).toBe(100);
  });

  it('offset negativo se clamps a 0', async () => {
    const db = makeDb({ selects: [[]] });
    const app = await buildApp({ db });
    const res = await app.request('/certificates?offset=-10', {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    const body = (await res.json()) as { pagination: { offset: number } };
    expect(body.pagination.offset).toBe(0);
  });
});

describe('GET /certificates/:tracking_code/verify', () => {
  it('config sin certificatesBucket → 503 certificates_disabled', async () => {
    const app = await buildApp({ db: makeDb(), certConfig: {} });
    const res = await app.request('/certificates/BOO-X/verify');
    expect(res.status).toBe(503);
  });

  it('tracking_code no existe → 404 tracking_code_not_found', async () => {
    const db = makeDb({ selects: [[]] });
    const app = await buildApp({ db, certConfig: VALID_CONFIG });
    const res = await app.request('/certificates/BOO-NOPE/verify');
    expect(res.status).toBe(404);
  });

  it('cert no emitido (issued_at null) → 404 certificate_not_issued', async () => {
    const db = makeDb({
      selects: [[{ empresaId: SHIPPER_EMP, certificateIssuedAt: null }]],
    });
    const app = await buildApp({ db, certConfig: VALID_CONFIG });
    const res = await app.request('/certificates/BOO-X/verify');
    expect(res.status).toBe(404);
    expect((await res.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'certificate_not_issued' }),
    );
  });

  it('trip sin empresa (anonymous) + cert issued → 404 defensivo', async () => {
    const db = makeDb({
      selects: [[{ empresaId: null, certificateIssuedAt: new Date() }]],
    });
    const app = await buildApp({ db, certConfig: VALID_CONFIG });
    const res = await app.request('/certificates/BOO-X/verify');
    expect(res.status).toBe(404);
  });

  it('sidecar no encontrado en GCS pese a issued → 500 certificate_artifacts_missing', async () => {
    (descargarSidecar as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const db = makeDb({
      selects: [[{ empresaId: SHIPPER_EMP, certificateIssuedAt: new Date() }]],
    });
    const app = await buildApp({ db, certConfig: VALID_CONFIG });
    const res = await app.request('/certificates/BOO-X/verify');
    expect(res.status).toBe(500);
    expect(noopLogger.error).toHaveBeenCalled();
  });

  it('happy path: retorna sidecar con valid:true + verification_hint', async () => {
    (descargarSidecar as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      trackingCode: 'BOO-X',
      signedAt: '2026-05-09T12:00:00Z',
      algorithm: 'RSA_SIGN_PKCS1_4096_SHA256',
      kmsKeyId: 'projects/x/keyRings/y/cryptoKeys/z',
      kmsKeyVersion: '1',
      pdfSha256: 'abc123',
      signatureB64: 'base64sig==',
      certPem: '-----BEGIN CERTIFICATE-----\n...',
      verifyUrl: 'https://api.test/certificates/BOO-X/verify',
    });
    const db = makeDb({
      selects: [[{ empresaId: SHIPPER_EMP, certificateIssuedAt: new Date() }]],
    });
    const app = await buildApp({ db, certConfig: VALID_CONFIG });
    const res = await app.request('/certificates/BOO-X/verify');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      valid: boolean;
      pdf_sha256: string;
      verification_hint: string;
    };
    expect(body.valid).toBe(true);
    expect(body.pdf_sha256).toBe('abc123');
    expect(body.verification_hint).toMatch(/openssl/);
  });
});
