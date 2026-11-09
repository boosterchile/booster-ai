import type { Logger } from '@booster-ai/logger';
import { type Context, Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BodyLimitException,
  DEFAULT_MAX_BODY_BYTES,
  MULTIPART_ENVELOPE_BYTES,
  createBodyLimitMiddleware,
} from './body-limit.js';

const noop = (): void => undefined;
const warn = vi.fn();
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

const LIMITE = 1024;
const LIMITE_SUBIDA = 4096;
const EXCEPCIONES: readonly BodyLimitException[] = [
  { method: 'POST', path: /^\/subidas\/[^/]+\/archivo$/, maxBytes: LIMITE_SUBIDA },
];

function crearApp(): Hono {
  const app = new Hono();
  app.use(
    '*',
    createBodyLimitMiddleware({ logger, defaultMaxBytes: LIMITE, exceptions: EXCEPCIONES }),
  );
  const eco = async (c: Context) => {
    const texto = await c.req.text();
    return c.json({ bytes: texto.length });
  };
  app.post('/eco', eco);
  app.put('/subidas/:id/archivo', eco);
  app.post('/subidas/:id/archivo', eco);
  app.post('/subidas/:id/archivo/extra', eco);
  app.get('/eco', (c) => c.json({ ok: true }));
  return app;
}

function crearAppSinExcepciones(): Hono {
  const app = new Hono();
  app.use('*', createBodyLimitMiddleware({ logger, defaultMaxBytes: LIMITE }));
  app.post('/subidas/:id/archivo', (c) => c.json({ ok: true }));
  return app;
}

function enStream(texto: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(texto);
  return new ReadableStream({
    start(controller) {
      // En trozos, como llega un cuerpo sin Content-Length.
      for (let i = 0; i < bytes.length; i += 256) {
        controller.enqueue(bytes.slice(i, i + 256));
      }
      controller.close();
    },
  });
}

function post(app: Hono, path: string, texto: string, opts: { conLargo: boolean }) {
  // `duplex` lo exige Node para un cuerpo en stream; el RequestInit del DOM no lo declara.
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.conLargo ? { 'content-length': String(Buffer.byteLength(texto)) } : {}),
    },
    body: opts.conLargo ? texto : enStream(texto),
    duplex: 'half',
  };
  return app.request(path, init);
}

describe('createBodyLimitMiddleware', () => {
  beforeEach(() => {
    warn.mockClear();
  });

  it('los valores por defecto son 64 KiB', () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(64 * 1024);
    expect(MULTIPART_ENVELOPE_BYTES).toBe(64 * 1024);
  });

  describe.each([
    ['con Content-Length', true],
    ['sin Content-Length', false],
  ])('%s', (_caso, conLargo) => {
    it('deja pasar un cuerpo dentro del límite y el handler lo puede leer', async () => {
      const res = await post(crearApp(), '/eco', 'a'.repeat(LIMITE), { conLargo });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ bytes: LIMITE });
      expect(warn).not.toHaveBeenCalled();
    });

    it('responde 413 a un cuerpo más grande que el límite', async () => {
      const res = await post(crearApp(), '/eco', 'a'.repeat(LIMITE + 1), { conLargo });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        error: 'payload_too_large',
        code: 'payload_too_large',
        max_bytes: LIMITE,
      });
    });

    it('la excepción permite más bytes en su ruta y método', async () => {
      const res = await post(crearApp(), '/subidas/x1/archivo', 'a'.repeat(LIMITE_SUBIDA), {
        conLargo,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ bytes: LIMITE_SUBIDA });
    });

    it('la excepción también tiene tope', async () => {
      const res = await post(crearApp(), '/subidas/x1/archivo', 'a'.repeat(LIMITE_SUBIDA + 1), {
        conLargo,
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ max_bytes: LIMITE_SUBIDA });
    });
  });

  it('la excepción no se aplica a otro método', async () => {
    const res = await crearApp().request('/subidas/x1/archivo', {
      method: 'PUT',
      body: 'a'.repeat(LIMITE + 1),
    });
    expect(res.status).toBe(413);
  });

  it('la excepción no se aplica a una ruta que solo empieza igual', async () => {
    const res = await post(crearApp(), '/subidas/x1/archivo/extra', 'a'.repeat(LIMITE + 1), {
      conLargo: true,
    });
    expect(res.status).toBe(413);
  });

  it('sin excepciones, el límite general rige en todas las rutas', async () => {
    const app = crearAppSinExcepciones();
    const dentro = await post(app, '/subidas/x1/archivo', 'a'.repeat(LIMITE), { conLargo: true });
    expect(dentro.status).toBe(200);
    const fuera = await post(app, '/subidas/x1/archivo', 'a'.repeat(LIMITE + 1), {
      conLargo: true,
    });
    expect(fuera.status).toBe(413);
  });

  it('un GET sin cuerpo pasa', async () => {
    const res = await crearApp().request('/eco');
    expect(res.status).toBe(200);
  });

  it('registra cada rechazo con método, ruta, límite y largo declarado', async () => {
    await post(crearApp(), '/eco', 'a'.repeat(LIMITE + 10), { conLargo: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {
        method: 'POST',
        path: '/eco',
        max_bytes: LIMITE,
        content_length: String(LIMITE + 10),
      },
      expect.any(String),
    );
  });

  it('sin Content-Length registra el largo declarado como null', async () => {
    await post(crearApp(), '/eco', 'a'.repeat(LIMITE + 10), { conLargo: false });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ content_length: null }),
      expect.any(String),
    );
  });

  it('exige límites enteros positivos', () => {
    expect(() => createBodyLimitMiddleware({ logger, defaultMaxBytes: 0 })).toThrow(RangeError);
    expect(() =>
      createBodyLimitMiddleware({
        logger,
        defaultMaxBytes: LIMITE,
        exceptions: [{ method: 'POST', path: /^\/x$/, maxBytes: 1.5 }],
      }),
    ).toThrow(RangeError);
  });

  it('rechaza rutas de excepción con expresiones regulares con estado', () => {
    for (const path of [/^\/x$/g, /^\/x$/y]) {
      expect(() =>
        createBodyLimitMiddleware({
          logger,
          defaultMaxBytes: LIMITE,
          exceptions: [{ method: 'POST', path, maxBytes: LIMITE_SUBIDA }],
        }),
      ).toThrow(RangeError);
    }
  });
});
