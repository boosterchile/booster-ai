import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.js';

// El env tiene que estar antes del primer import que parsea config.ts; por eso
// los módulos del server se importan dentro de cada test (mismo patrón que
// health.test.ts).
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'test-sa@test.iam.gserviceaccount.com';
});

const stubDb = {} as Db;
const stubPool = {} as pg.Pool;

async function crearServer() {
  const { createServer } = await import('../../src/server.js');
  return createServer({ db: stubDb, pool: stubPool });
}

function post(app: Awaited<ReturnType<typeof crearServer>>, path: string, bytes: number) {
  const cuerpo = 'a'.repeat(bytes);
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(bytes) },
    body: cuerpo,
  });
}

describe('límite de cuerpo en el server', () => {
  it('un cuerpo sobre el límite general recibe 413 aunque la ruta no exista', async () => {
    const { DEFAULT_MAX_BODY_BYTES } = await import('../../src/middleware/body-limit.js');
    const res = await post(await crearServer(), '/no-existe', DEFAULT_MAX_BODY_BYTES + 1);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: 'payload_too_large',
      code: 'payload_too_large',
      max_bytes: DEFAULT_MAX_BODY_BYTES,
    });
  });

  it('un cuerpo dentro del límite sigue su camino (404)', async () => {
    const { DEFAULT_MAX_BODY_BYTES } = await import('../../src/middleware/body-limit.js');
    const res = await post(await crearServer(), '/no-existe', DEFAULT_MAX_BODY_BYTES);
    expect(res.status).toBe(404);
  });

  it('corre antes del rate limit y de la autenticación', async () => {
    const { DEFAULT_MAX_BODY_BYTES } = await import('../../src/middleware/body-limit.js');
    const app = await crearServer();
    // Sin Redis, el rate limit del signup responde 503; sin token, /trip-requests 401.
    for (const path of ['/api/v1/signup-request', '/trip-requests']) {
      const res = await post(app, path, DEFAULT_MAX_BODY_BYTES + 1);
      expect(res.status, path).toBe(413);
    }
  });

  it('la subida de documentos de transporte acepta su archivo más el sobre multipart', async () => {
    const { MULTIPART_ENVELOPE_BYTES } = await import('../../src/middleware/body-limit.js');
    const { MAX_DOCUMENT_BYTES } = await import('../../src/routes/transport-documents.js');
    const app = await crearServer();
    const tope = MAX_DOCUMENT_BYTES + MULTIPART_ENVELOPE_BYTES;

    const dentro = await post(app, '/transport-orders/viaje-1/documents', tope);
    expect(dentro.status).not.toBe(413);

    const fuera = await post(app, '/transport-orders/viaje-1/documents', tope + 1);
    expect(fuera.status).toBe(413);
    expect(await fuera.json()).toMatchObject({ max_bytes: tope });
  });

  it('la subida de assets del sitio acepta su archivo más el sobre multipart', async () => {
    const { MULTIPART_ENVELOPE_BYTES } = await import('../../src/middleware/body-limit.js');
    const { MAX_ASSET_BYTES } = await import('../../src/routes/site-settings.js');
    const app = await crearServer();
    const tope = MAX_ASSET_BYTES + MULTIPART_ENVELOPE_BYTES;

    const dentro = await post(app, '/admin/site-settings/assets', tope);
    expect(dentro.status).not.toBe(413);

    const fuera = await post(app, '/admin/site-settings/assets', tope + 1);
    expect(fuera.status).toBe(413);
    expect(await fuera.json()).toMatchObject({ max_bytes: tope });
  });

  it('las excepciones no abren otras rutas del mismo prefijo', async () => {
    const { DEFAULT_MAX_BODY_BYTES } = await import('../../src/middleware/body-limit.js');
    const app = await crearServer();
    for (const path of ['/transport-orders/viaje-1', '/admin/site-settings/draft']) {
      const res = await post(app, path, DEFAULT_MAX_BODY_BYTES + 1);
      expect(res.status, path).toBe(413);
    }
  });
});
