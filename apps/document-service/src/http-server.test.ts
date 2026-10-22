import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '@booster-ai/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentUploadedHandler } from './handle-document-uploaded.js';
import { MAX_PUSH_BODY_BYTES, PUSH_PATH, createHttpHandler } from './http-server.js';

const noop = (): void => undefined;
function makeLogger() {
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => logger,
  };
  return logger;
}

const PAYLOAD = { documentId: '11111111-1111-1111-1111-111111111111' };

function envelope(overrides?: Record<string, unknown>) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(PAYLOAD)).toString('base64'),
      messageId: '1234567890',
      publishTime: '2026-10-21T12:00:00.000Z',
    },
    subscription: 'projects/booster-ai-494222/subscriptions/document-uploaded-processor-sub',
    deliveryAttempt: 1,
    ...overrides,
  };
}

let server: http.Server | null = null;

async function start(opts: Parameters<typeof createHttpHandler>[0]): Promise<string> {
  server = http.createServer(createHttpHandler(opts));
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

function pushDeps(decision: 'ack' | 'nack' = 'ack', authorized = true) {
  const verifyToken = vi.fn(async () => authorized);
  const handleMessage = vi.fn<DocumentUploadedHandler>(async () => decision);
  const registrarEntrega = vi.fn();
  return { verifyToken, handleMessage, registrarEntrega };
}

const post = (base: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${PUSH_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', ...headers },
    body,
  });

describe('createHttpHandler — /health', () => {
  it('responde 200 con el nombre del servicio', async () => {
    const base = await start({ logger: makeLogger() as never as Logger });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'document-service' });
  });

  it('responde 404 a cualquier otra ruta o método', async () => {
    const base = await start({ logger: makeLogger() as never as Logger, push: pushDeps() });
    expect((await fetch(`${base}/otra`)).status).toBe(404);
    expect((await fetch(`${base}${PUSH_PATH}`)).status).toBe(404);
  });
});

describe('createHttpHandler — push de document.uploaded', () => {
  it('sin SA configurado el endpoint no existe (404)', async () => {
    const base = await start({ logger: makeLogger() as never as Logger });
    expect((await post(base, JSON.stringify(envelope()))).status).toBe(404);
  });

  it('confirma con 204 y pasa los bytes decodificados, el messageId y el intento', async () => {
    const deps = pushDeps('ack');
    const base = await start({ logger: makeLogger() as never as Logger, push: deps });
    const res = await post(base, JSON.stringify(envelope({ deliveryAttempt: 3 })));
    expect(res.status).toBe(204);
    expect(deps.verifyToken).toHaveBeenCalledWith('Bearer tok');
    const delivery = deps.handleMessage.mock.calls[0]?.[0];
    expect(delivery?.messageId).toBe('1234567890');
    expect(delivery?.deliveryAttempt).toBe(3);
    expect(delivery?.transporte).toBe('push');
    // El resultado del procesamiento lo registra el handler, no el transporte.
    expect(deps.registrarEntrega).not.toHaveBeenCalled();
    expect(JSON.parse(delivery?.data.toString('utf-8') ?? '')).toEqual(PAYLOAD);
  });

  it('pide reintento con 500 cuando el manejador decide nack', async () => {
    const base = await start({ logger: makeLogger() as never as Logger, push: pushDeps('nack') });
    expect((await post(base, JSON.stringify(envelope()))).status).toBe(500);
  });

  it('rechaza con 401 un token no autorizado, sin procesar el mensaje', async () => {
    const deps = pushDeps('ack', false);
    const base = await start({ logger: makeLogger() as never as Logger, push: deps });
    expect((await post(base, JSON.stringify(envelope()))).status).toBe(401);
    expect(deps.handleMessage).not.toHaveBeenCalled();
    expect(deps.registrarEntrega).toHaveBeenCalledWith({
      transporte: 'push',
      resultado: 'no_autorizado',
    });
  });

  it('descarta (204) un body que no es JSON o un sobre fuera de contrato', async () => {
    const logger = makeLogger();
    const deps = pushDeps();
    const base = await start({ logger: logger as never as Logger, push: deps });
    expect((await post(base, 'no es json')).status).toBe(204);
    expect((await post(base, JSON.stringify({ message: { data: 'x' } }))).status).toBe(204);
    expect(deps.handleMessage).not.toHaveBeenCalled();
    expect(deps.registrarEntrega).toHaveBeenCalledTimes(2);
    expect(deps.registrarEntrega).toHaveBeenCalledWith({
      transporte: 'push',
      resultado: 'sobre_invalido',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'push document.uploaded con sobre inválido, ack para descartar (no reintentar)',
    );
  });

  it('descarta (204) un body sobre el tope sin procesarlo', async () => {
    const logger = makeLogger();
    const deps = pushDeps();
    const base = await start({ logger: logger as never as Logger, push: deps });
    const res = await post(base, 'x'.repeat(MAX_PUSH_BODY_BYTES + 1));
    expect(res.status).toBe(204);
    expect(deps.handleMessage).not.toHaveBeenCalled();
    expect(deps.registrarEntrega).toHaveBeenCalledWith({
      transporte: 'push',
      resultado: 'sobre_invalido',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: MAX_PUSH_BODY_BYTES + 1 }),
      'push document.uploaded excede el tope, ack para descartar (no reintentar)',
    );
  });

  it('responde 500 y registra si el transporte falla de forma inesperada', async () => {
    const logger = makeLogger();
    const deps = {
      verifyToken: vi.fn(async () => {
        throw new Error('jwks caído');
      }),
      handleMessage: vi.fn<DocumentUploadedHandler>(async () => 'ack'),
      registrarEntrega: vi.fn(),
    };
    const base = await start({ logger: logger as never as Logger, push: deps });
    expect((await post(base, JSON.stringify(envelope()))).status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'push document.uploaded: error inesperado, nack para reintento',
    );
  });
});
