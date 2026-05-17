import type { Logger } from '@booster-ai/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppApiError, WhatsAppClient } from './client.js';

function fakeLogger(): Logger {
  return {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

describe('WhatsAppApiError', () => {
  it('preserva status, responseBody y nombre', () => {
    const err = new WhatsAppApiError('boom', 429, { error: 'rate_limit' });
    expect(err.name).toBe('WhatsAppApiError');
    expect(err.status).toBe(429);
    expect(err.responseBody).toEqual({ error: 'rate_limit' });
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('WhatsAppClient.sendText', () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const baseOptions = {
    phoneNumberId: '1234567890',
    accessToken: 'EAAG-abc',
  };

  function okResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('POST a Graph API v20.0 con shape canónico de Meta', async () => {
    const logger = fakeLogger();
    fetchMock.mockResolvedValueOnce(
      okResponse({
        messaging_product: 'whatsapp',
        contacts: [{ input: '56912345678', wa_id: '56912345678' }],
        messages: [{ id: 'wamid.XXXX' }],
      }),
    );
    const client = new WhatsAppClient({ ...baseOptions, logger });
    const out = await client.sendText({ to: '56912345678', body: 'hola' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://graph.facebook.com/v20.0/1234567890/messages');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBe('Bearer EAAG-abc');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '56912345678',
      type: 'text',
      text: { body: 'hola', preview_url: false },
    });
    expect(out.messages?.[0]?.id).toBe('wamid.XXXX');
  });

  it('si replyTo se provee, agrega context.message_id', async () => {
    const logger = fakeLogger();
    fetchMock.mockResolvedValueOnce(okResponse({ messages: [{ id: 'x' }] }));
    const client = new WhatsAppClient({ ...baseOptions, logger });
    await client.sendText({ to: '569', body: 'reply', replyTo: 'wamid.ORIG' });
    const payload = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(payload.context).toEqual({ message_id: 'wamid.ORIG' });
  });

  it('preview_url=false NUNCA es overrideable (anti-spam Meta)', async () => {
    const logger = fakeLogger();
    fetchMock.mockResolvedValueOnce(okResponse({ messages: [{ id: 'x' }] }));
    const client = new WhatsAppClient({ ...baseOptions, logger });
    await client.sendText({ to: '569', body: 'http://link.com' });
    const payload = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(payload.text.preview_url).toBe(false);
  });

  it('error non-2xx → throw WhatsAppApiError con status + body + log error', async () => {
    const logger = fakeLogger();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 100, message: 'invalid' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new WhatsAppClient({ ...baseOptions, logger });
    await expect(client.sendText({ to: '569', body: 'x' })).rejects.toMatchObject({
      name: 'WhatsAppApiError',
      status: 400,
      responseBody: { error: { code: 100, message: 'invalid' } },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 400, to: '569' }),
      'WhatsApp API sendText failed',
    );
  });

  it('responseBody JSON inválido → fallback a {} (no rompe), igual logea ok si 2xx', async () => {
    const logger = fakeLogger();
    fetchMock.mockResolvedValueOnce(
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const client = new WhatsAppClient({ ...baseOptions, logger });
    const out = await client.sendText({ to: '569', body: 'x' });
    expect(out).toEqual({});
    expect(logger.debug).toHaveBeenCalled();
  });

  it('timeoutMs default 10_000 (no aborta en respuesta rápida)', async () => {
    const logger = fakeLogger();
    fetchMock.mockResolvedValueOnce(okResponse({ messages: [{ id: 'x' }] }));
    const client = new WhatsAppClient({ ...baseOptions, logger });
    await client.sendText({ to: '569', body: 'x' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('timeoutMs explícito se aplica al AbortController', async () => {
    const logger = fakeLogger();
    // Simula fetch que nunca resuelve hasta que el AbortSignal se dispara
    fetchMock.mockImplementationOnce((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const client = new WhatsAppClient({ ...baseOptions, logger, timeoutMs: 20 });
    await expect(client.sendText({ to: '569', body: 'x' })).rejects.toThrow(/abort/i);
  });
});
