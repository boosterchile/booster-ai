import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock web-push lib (no queremos hacer HTTP real ni configurar VAPID).
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

const webpush = (await import('web-push')).default as unknown as {
  setVapidDetails: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
};

const { configureWebPush, notifyChatMessageViaPush, sendPushToUser } = await import(
  '../../src/services/web-push.js'
);

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
  updates?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const updates = [...(queues.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve(selects.shift() ?? []));
    return chain;
  };

  const buildUpdateChain = () => ({
    set: vi.fn(() => ({ where: vi.fn(async () => updates.shift() ?? []) })),
  });

  return {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Forzar reconfigure each test usando la primera llamada
  configureWebPush({
    publicKey: 'pub-key',
    privateKey: 'priv-key',
    subject: 'mailto:dev@boosterchile.com',
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('configureWebPush', () => {
  it('llama webpush.setVapidDetails con los args correctos', () => {
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:dev@boosterchile.com',
      'pub-key',
      'priv-key',
    );
  });

  it('idempotente: segunda llamada no re-invoca setVapidDetails', () => {
    vi.clearAllMocks();
    configureWebPush({ publicKey: 'p2', privateKey: 'k2', subject: 's2' });
    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
  });
});

describe('sendPushToUser', () => {
  const PAYLOAD = {
    title: 'Nuevo msg',
    body: 'hola',
    tag: 'chat-1',
    data: { assignment_id: 'a1', message_id: 'm1', url: '/app/chat/a1' },
  };

  it('0 subscriptions activas → retorna { sent:0, invalidated:0, errored:0 }', async () => {
    const db = makeDb({ selects: [[]] });
    const result = await sendPushToUser({
      db: db as never,
      logger: noopLogger,
      userId: 'user-1',
      payload: PAYLOAD,
    });
    expect(result).toEqual({ sent: 0, invalidated: 0, errored: 0 });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('1 subscription activa OK → sent=1', async () => {
    webpush.sendNotification.mockResolvedValueOnce(undefined);
    const db = makeDb({
      selects: [
        [{ id: 'sub-1', endpoint: 'https://fcm.googleapis.com/x', p256dhKey: 'pk', authKey: 'ak' }],
      ],
    });
    const result = await sendPushToUser({
      db: db as never,
      logger: noopLogger,
      userId: 'user-1',
      payload: PAYLOAD,
    });
    expect(result).toEqual({ sent: 1, invalidated: 0, errored: 0 });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('410 Gone → marca subscription inactiva (invalidated=1)', async () => {
    webpush.sendNotification.mockRejectedValueOnce({ statusCode: 410, body: 'Gone' });
    const db = makeDb({
      selects: [[{ id: 'sub-1', endpoint: 'https://x', p256dhKey: 'pk', authKey: 'ak' }]],
      updates: [[]],
    });
    const result = await sendPushToUser({
      db: db as never,
      logger: noopLogger,
      userId: 'user-1',
      payload: PAYLOAD,
    });
    expect(result).toEqual({ sent: 0, invalidated: 1, errored: 0 });
  });

  it('404 Not Found → también marca inactive', async () => {
    webpush.sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    const db = makeDb({
      selects: [[{ id: 's2', endpoint: 'https://y', p256dhKey: 'pk', authKey: 'ak' }]],
      updates: [[]],
    });
    const result = await sendPushToUser({
      db: db as never,
      logger: noopLogger,
      userId: 'u',
      payload: PAYLOAD,
    });
    expect(result.invalidated).toBe(1);
  });

  it('5xx → errored, no marca inactive', async () => {
    webpush.sendNotification.mockRejectedValueOnce({ statusCode: 503 });
    const db = makeDb({
      selects: [[{ id: 's3', endpoint: 'https://z', p256dhKey: 'pk', authKey: 'ak' }]],
    });
    const result = await sendPushToUser({
      db: db as never,
      logger: noopLogger,
      userId: 'u',
      payload: PAYLOAD,
    });
    expect(result).toEqual({ sent: 0, invalidated: 0, errored: 1 });
  });

  it('error sin statusCode → errored', async () => {
    webpush.sendNotification.mockRejectedValueOnce(new Error('network'));
    const db = makeDb({
      selects: [[{ id: 's4', endpoint: 'https://w', p256dhKey: 'pk', authKey: 'ak' }]],
    });
    const result = await sendPushToUser({
      db: db as never,
      logger: noopLogger,
      userId: 'u',
      payload: PAYLOAD,
    });
    expect(result.errored).toBe(1);
  });

  it('múltiples subscriptions: sent + invalidated cuentan independientemente', async () => {
    webpush.sendNotification
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ statusCode: 410 });
    const db = makeDb({
      selects: [
        [
          { id: 's1', endpoint: 'e1', p256dhKey: 'pk', authKey: 'ak' },
          { id: 's2', endpoint: 'e2', p256dhKey: 'pk', authKey: 'ak' },
          { id: 's3', endpoint: 'e3', p256dhKey: 'pk', authKey: 'ak' },
        ],
      ],
      updates: [[]],
    });
    const result = await sendPushToUser({
      db: db as never,
      logger: noopLogger,
      userId: 'u',
      payload: PAYLOAD,
    });
    expect(result.sent).toBe(2);
    expect(result.invalidated).toBe(1);
  });
});

describe('notifyChatMessageViaPush', () => {
  const MSG_BASE = {
    messageId: 'msg-1',
    assignmentId: 'assign-1',
    senderUserId: 'sender-user',
    senderEmpresaId: 'sender-emp',
    senderRole: 'transportista',
    messageType: 'texto',
    textContent: 'hola desde el camión',
    shipperEmpresaId: 'shipper-emp',
    carrierEmpresaId: 'carrier-emp',
  };

  it('mensaje no existe → return temprano (warn log)', async () => {
    const db = makeDb({ selects: [[]] });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'no-existe',
      webAppUrl: 'https://app.test',
    });
    expect(noopLogger.warn).toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('shipperEmpresaId null + sender=transportista → empresa destinataria null, skip', async () => {
    const db = makeDb({
      selects: [[{ ...MSG_BASE, shipperEmpresaId: null }]],
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test',
    });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('0 recipients → no hace nada', async () => {
    const db = makeDb({
      selects: [[MSG_BASE], []], // mensaje OK, recipients vacío
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test',
    });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('happy path: dispatch a 1 recipient con 1 subscription', async () => {
    webpush.sendNotification.mockResolvedValueOnce(undefined);
    const db = makeDb({
      selects: [
        [MSG_BASE], // mensaje
        [{ userId: 'recipient-user' }], // recipients
        [{ id: 's1', endpoint: 'e1', p256dhKey: 'pk', authKey: 'ak' }], // subs del recipient
      ],
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test',
    });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('mensaje tipo foto → preview "📷 Te envió una foto"', async () => {
    webpush.sendNotification.mockResolvedValueOnce(undefined);
    const db = makeDb({
      selects: [
        [{ ...MSG_BASE, messageType: 'foto', textContent: null }],
        [{ userId: 'recipient' }],
        [{ id: 's', endpoint: 'e', p256dhKey: 'pk', authKey: 'ak' }],
      ],
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test',
    });
    const call = webpush.sendNotification.mock.calls[0]?.[1] as string;
    const payload = JSON.parse(call);
    expect(payload.body).toContain('📷');
  });

  it('mensaje tipo ubicacion → preview "📍 Te compartió una ubicación"', async () => {
    webpush.sendNotification.mockResolvedValueOnce(undefined);
    const db = makeDb({
      selects: [
        [{ ...MSG_BASE, messageType: 'ubicacion', textContent: null }],
        [{ userId: 'r' }],
        [{ id: 's', endpoint: 'e', p256dhKey: 'pk', authKey: 'ak' }],
      ],
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test',
    });
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0]?.[1] as string);
    expect(payload.body).toContain('📍');
  });

  it('texto > 80 chars → trunca con elipsis', async () => {
    webpush.sendNotification.mockResolvedValueOnce(undefined);
    const longText = 'a'.repeat(150);
    const db = makeDb({
      selects: [
        [{ ...MSG_BASE, textContent: longText }],
        [{ userId: 'r' }],
        [{ id: 's', endpoint: 'e', p256dhKey: 'pk', authKey: 'ak' }],
      ],
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test',
    });
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0]?.[1] as string);
    expect(payload.body.length).toBeLessThanOrEqual(81);
    expect(payload.body).toContain('…');
  });

  it('senderRole=generador_carga → recipient=carrier', async () => {
    webpush.sendNotification.mockResolvedValueOnce(undefined);
    const db = makeDb({
      selects: [
        [{ ...MSG_BASE, senderRole: 'generador_carga' }],
        [{ userId: 'carrier-user' }],
        [{ id: 's', endpoint: 'e', p256dhKey: 'pk', authKey: 'ak' }],
      ],
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test',
    });
    expect(webpush.sendNotification).toHaveBeenCalled();
  });

  it('webAppUrl con trailing slash se normaliza al armar deep link', async () => {
    webpush.sendNotification.mockResolvedValueOnce(undefined);
    const db = makeDb({
      selects: [
        [MSG_BASE],
        [{ userId: 'r' }],
        [{ id: 's', endpoint: 'e', p256dhKey: 'pk', authKey: 'ak' }],
      ],
    });
    await notifyChatMessageViaPush({
      db: db as never,
      logger: noopLogger,
      messageId: 'msg-1',
      webAppUrl: 'https://app.test/',
    });
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0]?.[1] as string);
    expect(payload.data.url).toBe('https://app.test/app/chat/assign-1');
  });
});
