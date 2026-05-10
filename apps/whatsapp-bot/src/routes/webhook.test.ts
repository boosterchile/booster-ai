import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import type Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '../conversation/store.js';
import type { ApiClient } from '../services/api-client.js';
import { createWebhookRoutes } from './webhook.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<typeof createWebhookRoutes>[0]['logger'];

let signatureValid = true;
vi.mock('@booster-ai/whatsapp-client', async () => {
  const actual = await vi.importActual<typeof import('@booster-ai/whatsapp-client')>(
    '@booster-ai/whatsapp-client',
  );
  return {
    ...actual,
    verifyTwilioSignature: vi.fn(() => signatureValid),
  };
});

interface RedisStub {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

function makeRedisStub(): RedisStub {
  const map = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => map.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      // Simula NX sólo cuando el caller lo pide explícitamente.
      const wantsNx = args.includes('NX');
      if (wantsNx && map.has(key)) {
        return null;
      }
      map.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (map.delete(key) ? 1 : 0)),
  };
}

function makeApp(opts?: {
  store?: ConversationStore;
  whatsAppClient?: TwilioWhatsAppClient;
  apiClient?: ApiClient;
  redis?: RedisStub;
}) {
  const redis = opts?.redis ?? makeRedisStub();
  const store =
    opts?.store ??
    new ConversationStore(redis as unknown as Redis, 30 * 60 * 1000, noopLogger as never);
  const sendText = vi.fn(async () => undefined);
  const whatsAppClient = (opts?.whatsAppClient ?? { sendText }) as unknown as TwilioWhatsAppClient;
  const createTripRequest = vi.fn(async () => ({ tracking_code: 'TR-9', id: 'uuid-9' }));
  const apiClient = (opts?.apiClient ?? { createTripRequest }) as unknown as ApiClient;

  const app = createWebhookRoutes({
    store,
    whatsAppClient,
    apiClient,
    redis: redis as unknown as Redis,
    authToken: 'test_token',
    webhookUrl: 'https://example.test/webhooks/whatsapp',
    logger: noopLogger,
  });

  return { app, redis, store, whatsAppClient, apiClient, sendText, createTripRequest };
}

function form(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

beforeEach(() => {
  signatureValid = true;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /webhooks/whatsapp', () => {
  it('responde 200 OK (Twilio health ping)', async () => {
    const { app } = makeApp();
    const res = await app.request('/webhooks/whatsapp', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});

describe('POST /webhooks/whatsapp — validation paths', () => {
  it('firma inválida retorna 403', async () => {
    signatureValid = false;
    const { app } = makeApp();
    const res = await app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ From: 'whatsapp:+56912345678', Body: 'hola', MessageSid: 'SM1' }),
    });
    expect(res.status).toBe(403);
  });

  it('falta From retorna 400', async () => {
    const { app } = makeApp();
    const res = await app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ Body: 'hola', MessageSid: 'SM2' }),
    });
    expect(res.status).toBe(400);
  });

  it('From sin prefijo whatsapp: retorna 400', async () => {
    const { app } = makeApp();
    const res = await app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ From: '+56912345678', Body: 'hola', MessageSid: 'SM3' }),
    });
    expect(res.status).toBe(400);
  });

  it('sin Body (event de status) retorna 200 sin procesar', async () => {
    const { app, sendText } = makeApp();
    const res = await app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ From: 'whatsapp:+56912345678', MessageSid: 'SM4' }),
    });
    expect(res.status).toBe(200);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('teléfono no chileno se ignora silenciosamente (200 sin sendText)', async () => {
    const { app, sendText } = makeApp();
    const res = await app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ From: 'whatsapp:+15558675309', Body: 'hello', MessageSid: 'SM5' }),
    });
    expect(res.status).toBe(200);
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/whatsapp — happy paths', () => {
  it('"hola" desde número chileno responde con greeting', async () => {
    const { app, sendText } = makeApp();
    const res = await app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ From: 'whatsapp:+56912345678', Body: 'hola', MessageSid: 'SM6' }),
    });
    expect(res.status).toBe(200);
    expect(sendText).toHaveBeenCalledTimes(1);
    const sentText = (sendText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sentText.to).toBe('+56912345678');
    expect(sentText.body).toMatch(/Booster AI/);
  });

  it('mensaje duplicado (dedup) retorna 200 sin re-procesar', async () => {
    const ctx = makeApp();
    const payload = form({
      From: 'whatsapp:+56912345678',
      Body: 'hola',
      MessageSid: 'SM-DUP',
    });

    const r1 = await ctx.app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: payload,
    });
    const r2 = await ctx.app.request('/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: payload,
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Solo se mandó respuesta una vez; el segundo fue noop por dedup.
    expect(ctx.sendText).toHaveBeenCalledTimes(1);
  });

  it('flujo end-to-end: hola → 1 → origen → destino → cargo → fecha → submitted llama apiClient.createTripRequest', async () => {
    const ctx = makeApp();

    async function send(body: string, sid: string) {
      const res = await ctx.app.request('/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ From: 'whatsapp:+56987654321', Body: body, MessageSid: sid }),
      });
      expect(res.status).toBe(200);
    }

    await send('hola', 'SM01');
    await send('1', 'SM02');
    await send('Av. Quilín 1234, Santiago', 'SM03');
    await send('Puerto de Valparaíso', 'SM04');
    await send('1', 'SM05'); // cargo_seca
    await send('mañana 9am', 'SM06');

    expect(ctx.createTripRequest).toHaveBeenCalledTimes(1);
    const arg = (ctx.createTripRequest as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.shipper_whatsapp).toBe('+56987654321');
    expect(arg.origin_address_raw).toBe('Av. Quilín 1234, Santiago');
    expect(arg.destination_address_raw).toBe('Puerto de Valparaíso');
    expect(arg.cargo_type).toBe('carga_seca');
    expect(arg.pickup_date_raw).toBe('mañana 9am');
  });

  it('si apiClient.createTripRequest falla, manda mensaje de fallback al user', async () => {
    const failingApiClient = {
      createTripRequest: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as ApiClient;

    const ctx = makeApp({ apiClient: failingApiClient });

    async function send(body: string, sid: string) {
      await ctx.app.request('/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ From: 'whatsapp:+56987654321', Body: body, MessageSid: sid }),
      });
    }

    await send('hola', 'SF01');
    await send('1', 'SF02');
    await send('Stgo', 'SF03');
    await send('Vpo', 'SF04');
    await send('1', 'SF05');
    await send('mañana', 'SF06');

    const calls = (ctx.sendText as ReturnType<typeof vi.fn>).mock.calls;
    const lastBody = calls[calls.length - 1]?.[0]?.body as string;
    expect(lastBody).toMatch(/no pudimos registrar/i);
  });
});

describe('POST /webhooks/twilio-status', () => {
  it('firma inválida retorna 403', async () => {
    signatureValid = false;
    const { app } = makeApp();
    const res = await app.request('/webhooks/twilio-status', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ MessageSid: 'SMa', MessageStatus: 'delivered' }),
    });
    expect(res.status).toBe(403);
  });

  it('status delivered retorna 200 (info log)', async () => {
    const { app } = makeApp();
    const res = await app.request('/webhooks/twilio-status', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        MessageSid: 'SMb',
        MessageStatus: 'delivered',
        To: 'whatsapp:+56912345678',
        From: 'whatsapp:+19383365293',
      }),
    });
    expect(res.status).toBe(200);
    expect(noopLogger.info).toHaveBeenCalled();
  });

  it('status failed loggea como error y retorna 200', async () => {
    const { app } = makeApp();
    const res = await app.request('/webhooks/twilio-status', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        MessageSid: 'SMc',
        MessageStatus: 'failed',
        ErrorCode: '63016',
        ErrorMessage: 'sandbox not joined',
      }),
    });
    expect(res.status).toBe(200);
    expect(noopLogger.error).toHaveBeenCalled();
  });
});
