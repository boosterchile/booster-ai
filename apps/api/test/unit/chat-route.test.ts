import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

// Mock chat-pubsub y web-push porque son fire-and-forget desde el handler
// y ya están cubiertos por sus tests propios.
vi.mock('../../src/services/chat-pubsub.js', () => ({
  publishChatMessage: vi.fn(async () => undefined),
  createEphemeralChatSubscription: vi.fn(),
}));
vi.mock('../../src/services/web-push.js', () => ({
  notifyChatMessageViaPush: vi.fn(async () => undefined),
}));
const getSignedUrlMock = vi.fn(async () => ['https://storage.googleapis.com/signed-url']);
const fileMock = vi.fn(() => ({ getSignedUrl: getSignedUrlMock }));
const bucketMock = vi.fn(() => ({ file: fileMock }));
vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket = bucketMock;
  },
}));

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
  inserts?: unknown[][];
  updates?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const inserts = [...(queues.inserts ?? [])];
  const updates = [...(queues.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve(selects.shift() ?? []));
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => inserts.shift() ?? []),
    })),
  });

  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => updates.shift() ?? []),
      })),
    })),
  });

  return {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
    update: vi.fn(() => buildUpdateChain()),
  };
}

const ASSIGN_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const SHIPPER_EMP = 'shipper-emp';
const CARRIER_EMP = 'carrier-emp';
const USER_ID = 'user-uuid';

const ACCESS_ROW_SHIPPER = {
  assignmentId: ASSIGN_ID,
  assignmentStatus: 'asignado',
  carrierEmpresaId: CARRIER_EMP,
  shipperEmpresaId: SHIPPER_EMP,
};

const SHIPPER_CTX = JSON.stringify({
  user: { id: USER_ID },
  activeMembership: { empresa: { id: SHIPPER_EMP } },
});
const CARRIER_CTX = JSON.stringify({
  user: { id: USER_ID },
  activeMembership: { empresa: { id: CARRIER_EMP } },
});
const STRANGER_CTX = JSON.stringify({
  user: { id: USER_ID },
  activeMembership: { empresa: { id: 'OTRA-empresa' } },
});

async function buildApp(opts: {
  db: unknown;
  attachmentsBucket?: string;
  pubsubTopic?: string;
  webAppUrl?: string;
}) {
  const { createChatRoutes } = await import('../../src/routes/chat.js');
  const app = new Hono();
  app.use('/chat/*', async (c, next) => {
    const ctx = c.req.header('x-test-userctx');
    if (ctx) {
      c.set('userContext', JSON.parse(ctx));
    }
    await next();
  });
  app.route('/chat', createChatRoutes({ ...opts, db: opts.db as never, logger: noopLogger }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /chat/:id/messages', () => {
  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(401);
  });

  it('sin activeMembership → 403 no_active_empresa', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-userctx': JSON.stringify({ user: { id: 'u' }, activeMembership: null }),
      },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(403);
  });

  it('assignment no existe → 404', async () => {
    const db = makeDb({ selects: [[]] });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(404);
  });

  it('user no es ni shipper ni carrier → 403 forbidden_not_party', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': STRANGER_CTX },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(403);
  });

  it('assignment status entregado → 409 chat_closed', async () => {
    const db = makeDb({
      selects: [[{ ...ACCESS_ROW_SHIPPER, assignmentStatus: 'entregado' }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(409);
  });

  it('happy path texto: 201 con message serializado', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER]],
      inserts: [
        [
          {
            id: 'msg-1',
            messageType: 'texto',
            textContent: 'hola',
            createdAt: new Date(),
          },
        ],
      ],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(201);
  });

  it('foto sin attachmentsBucket configurado → 503 attachments_disabled', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({
        type: 'foto',
        photo_gcs_uri: `gs://my-bucket/chat/${ASSIGN_ID}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`,
      }),
    });
    expect(res.status).toBe(503);
  });

  it('foto con URI de bucket distinto → 400 photo_uri_mismatch', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db, attachmentsBucket: 'my-bucket' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({
        type: 'foto',
        photo_gcs_uri: `gs://otra-bucket/chat/${ASSIGN_ID}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('happy path foto: 201', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER]],
      inserts: [[{ id: 'm-photo', messageType: 'foto', photoGcsUri: 'x', createdAt: new Date() }]],
    });
    const app = await buildApp({ db, attachmentsBucket: 'my-bucket' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({
        type: 'foto',
        photo_gcs_uri: `gs://my-bucket/chat/${ASSIGN_ID}/abc-123.jpg`,
      }),
    });
    expect(res.status).toBe(201);
  });

  it('happy path ubicacion: 201', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER]],
      inserts: [[{ id: 'm-loc', messageType: 'ubicacion', createdAt: new Date() }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({
        type: 'ubicacion',
        location_lat: -33.45,
        location_lng: -70.65,
      }),
    });
    expect(res.status).toBe(201);
  });

  it('texto vacío rechaza por zod (min 1)', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ type: 'texto', text: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('lat fuera de rango → 400 (zod min/max)', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ type: 'ubicacion', location_lat: 99, location_lng: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('INSERT retorna empty → 500', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER]],
      inserts: [[]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /chat/:id/messages', () => {
  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`);
    expect(res.status).toBe(401);
  });

  it('happy path: lista mensajes (sin cursor)', async () => {
    const db = makeDb({
      selects: [
        [ACCESS_ROW_SHIPPER],
        [
          {
            id: 'm1',
            senderEmpresaId: SHIPPER_EMP,
            senderUserId: USER_ID,
            senderRole: 'generador_carga',
            messageType: 'texto',
            textContent: 'hola',
            photoGcsUri: null,
            locationLat: null,
            locationLng: null,
            readAt: null,
            createdAt: new Date('2026-05-10T10:00:00Z'),
            senderName: 'Felipe',
          },
        ],
      ],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages`, {
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[]; viewer_role: string };
    expect(body.messages).toHaveLength(1);
    expect(body.viewer_role).toBe('generador_carga');
  });

  it('cursor inválido (uuid pero no existe) → 400 invalid_cursor', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER], []], // access OK, cursor no existe
    });
    const app = await buildApp({ db });
    const res = await app.request(
      `/chat/${ASSIGN_ID}/messages?cursor=00000000-0000-0000-0000-000000000000`,
      {
        headers: { 'x-test-userctx': SHIPPER_CTX },
      },
    );
    expect(res.status).toBe(400);
  });

  it('limit fuera de rango (>100) → 400 zod', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages?limit=500`, {
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /chat/:id/messages/photo-upload-url', () => {
  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/photo-upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/jpeg' }),
    });
    expect(res.status).toBe(401);
  });

  it('sin attachmentsBucket → 503', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/photo-upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ content_type: 'image/jpeg' }),
    });
    expect(res.status).toBe(503);
  });

  it('chat_closed (entregado) → 409', async () => {
    const db = makeDb({
      selects: [[{ ...ACCESS_ROW_SHIPPER, assignmentStatus: 'entregado' }]],
    });
    const app = await buildApp({ db, attachmentsBucket: 'b' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/photo-upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ content_type: 'image/jpeg' }),
    });
    expect(res.status).toBe(409);
  });

  it('content_type inválido → 400 zod', async () => {
    const app = await buildApp({ db: makeDb(), attachmentsBucket: 'b' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/photo-upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ content_type: 'image/gif' }),
    });
    expect(res.status).toBe(400);
  });

  it('happy path image/jpeg: 200 con upload_url + gcs_uri (extensión .jpg)', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db, attachmentsBucket: 'my-bucket' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/photo-upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ content_type: 'image/jpeg' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload_url: string; gcs_uri: string };
    expect(body.gcs_uri).toContain('.jpg');
    expect(body.gcs_uri).toContain(`/chat/${ASSIGN_ID}/`);
  });

  it('happy path image/png: extensión .png', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db, attachmentsBucket: 'my-bucket' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/photo-upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ content_type: 'image/png' }),
    });
    const body = (await res.json()) as { gcs_uri: string };
    expect(body.gcs_uri).toContain('.png');
  });

  it('happy path image/webp: extensión .webp', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db, attachmentsBucket: 'my-bucket' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/photo-upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': SHIPPER_CTX },
      body: JSON.stringify({ content_type: 'image/webp' }),
    });
    const body = (await res.json()) as { gcs_uri: string };
    expect(body.gcs_uri).toContain('.webp');
  });
});

describe('POST /chat/:id/messages/:msgId/photo-url', () => {
  const MSG_ID = 'bbbbbbbb-1111-2222-3333-444444444444';

  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/${MSG_ID}/photo-url`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('sin attachmentsBucket → 503', async () => {
    const db = makeDb({ selects: [[ACCESS_ROW_SHIPPER]] });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/${MSG_ID}/photo-url`, {
      method: 'POST',
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(503);
  });

  it('mensaje no existe → 404 message_not_found', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER], []],
    });
    const app = await buildApp({ db, attachmentsBucket: 'b' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/${MSG_ID}/photo-url`, {
      method: 'POST',
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(404);
  });

  it('mensaje existe pero de OTRO assignment → 404 message_not_found', async () => {
    const db = makeDb({
      selects: [
        [ACCESS_ROW_SHIPPER],
        [
          {
            id: MSG_ID,
            assignmentId: 'OTRO-assignment',
            messageType: 'foto',
            photoGcsUri: 'gs://b/chat/x.jpg',
          },
        ],
      ],
    });
    const app = await buildApp({ db, attachmentsBucket: 'b' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/${MSG_ID}/photo-url`, {
      method: 'POST',
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(404);
  });

  it('mensaje no es foto → 400 not_a_photo', async () => {
    const db = makeDb({
      selects: [
        [ACCESS_ROW_SHIPPER],
        [
          {
            id: MSG_ID,
            assignmentId: ASSIGN_ID,
            messageType: 'texto',
            photoGcsUri: null,
          },
        ],
      ],
    });
    const app = await buildApp({ db, attachmentsBucket: 'b' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/${MSG_ID}/photo-url`, {
      method: 'POST',
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(400);
  });

  it('foto con URI de bucket distinto → 400 photo_uri_mismatch', async () => {
    const db = makeDb({
      selects: [
        [ACCESS_ROW_SHIPPER],
        [
          {
            id: MSG_ID,
            assignmentId: ASSIGN_ID,
            messageType: 'foto',
            photoGcsUri: 'gs://otro-bucket/chat/x.jpg',
          },
        ],
      ],
    });
    const app = await buildApp({ db, attachmentsBucket: 'my-bucket' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/${MSG_ID}/photo-url`, {
      method: 'POST',
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(400);
  });

  it('happy path: 200 con download_url', async () => {
    const db = makeDb({
      selects: [
        [ACCESS_ROW_SHIPPER],
        [
          {
            id: MSG_ID,
            assignmentId: ASSIGN_ID,
            messageType: 'foto',
            photoGcsUri: `gs://my-bucket/chat/${ASSIGN_ID}/abc.jpg`,
          },
        ],
      ],
    });
    const app = await buildApp({ db, attachmentsBucket: 'my-bucket' });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/${MSG_ID}/photo-url`, {
      method: 'POST',
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { download_url: string };
    expect(body.download_url).toBe('https://storage.googleapis.com/signed-url');
  });
});

describe('PATCH /chat/:id/messages/read', () => {
  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/read`, { method: 'PATCH' });
    expect(res.status).toBe(401);
  });

  it('happy path carrier: marca N mensajes leídos del shipper', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER]],
      updates: [[{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/read`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': CARRIER_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { marked_read: number };
    expect(body.marked_read).toBe(3);
  });

  it('happy path shipper: marca 0 mensajes leídos cuando no hay del carrier', async () => {
    const db = makeDb({
      selects: [[ACCESS_ROW_SHIPPER]],
      updates: [[]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/chat/${ASSIGN_ID}/messages/read`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': SHIPPER_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { marked_read: number };
    expect(body.marked_read).toBe(0);
  });
});
