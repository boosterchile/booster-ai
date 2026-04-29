import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwilioApiError, TwilioWhatsAppClient } from './twilio-client.js';

// Logger no-op para los tests.
const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
} as unknown as Parameters<typeof TwilioWhatsAppClient>[0]['logger'];

const ACCOUNT_SID = 'AC1234567890abcdef';
const AUTH_TOKEN = 'test_auth_token';
const FROM_NUMBER = '+19383365293';

describe('TwilioWhatsAppClient.sendText', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeClient() {
    return new TwilioWhatsAppClient({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      logger: noopLogger,
      timeoutMs: 1000,
    });
  }

  it('POSTs to correct Twilio URL with form-encoded body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          sid: 'SM_test_123',
          status: 'queued',
          to: 'whatsapp:+56957790379',
          from: `whatsapp:${FROM_NUMBER}`,
          body: 'hola',
          date_created: '2026-04-29T22:00:00Z',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );

    const client = makeClient();
    const result = await client.sendText({ to: '+56957790379', body: 'hola' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );

    // Verificar Basic auth: base64(SID:Token).
    const authHeader = (init?.headers as Record<string, string>).authorization;
    expect(authHeader).toBe(
      `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
    );

    // Verificar body form-encoded.
    const body = init?.body as string;
    const params = new URLSearchParams(body);
    expect(params.get('From')).toBe(`whatsapp:${FROM_NUMBER}`);
    expect(params.get('To')).toBe('whatsapp:+56957790379');
    expect(params.get('Body')).toBe('hola');

    expect(result.sid).toBe('SM_test_123');
  });

  it('adds whatsapp: prefix if missing', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 201 }));
    const client = makeClient();
    await client.sendText({ to: '+56957790379', body: 'test' });
    const body = fetchSpy.mock.calls[0]![1]?.body as string;
    const params = new URLSearchParams(body);
    expect(params.get('To')).toBe('whatsapp:+56957790379');
  });

  it('does not double-prefix if already whatsapp:', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 201 }));
    const client = makeClient();
    await client.sendText({ to: 'whatsapp:+56957790379', body: 'test' });
    const body = fetchSpy.mock.calls[0]![1]?.body as string;
    const params = new URLSearchParams(body);
    expect(params.get('To')).toBe('whatsapp:+56957790379');
  });

  it('throws TwilioApiError on 4xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ code: 21211, message: 'Invalid To number' }), {
        status: 400,
      }),
    );
    const client = makeClient();
    await expect(client.sendText({ to: '+invalid', body: 'x' })).rejects.toBeInstanceOf(
      TwilioApiError,
    );
  });

  it('throws TwilioApiError on 5xx response', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 503 }));
    const client = makeClient();
    await expect(client.sendText({ to: '+56957790379', body: 'x' })).rejects.toBeInstanceOf(
      TwilioApiError,
    );
  });

  it('aborts request after timeout', async () => {
    // Simulamos fetch que nunca resuelve y verificamos que el AbortSignal lo cancela.
    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const client = new TwilioWhatsAppClient({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      logger: noopLogger,
      timeoutMs: 50,
    });
    await expect(client.sendText({ to: '+56957790379', body: 'x' })).rejects.toThrow();
  });
});
