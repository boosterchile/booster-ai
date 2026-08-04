import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggingEmailSender, ResendEmailSender, crearEmailSender } from './email-sender.js';

/**
 * Primera infraestructura de correo de la plataforma.
 *
 * Hasta 2026-08-03 el repo NO enviaba un solo correo: el
 * `LoggingSignupRequestNotifier` escribía structured logs y su propio docstring
 * lo declaraba. El conductor Javier Poblete se dio de alta en producción y
 * nunca recibió nada — ese es el incidente que origina este módulo.
 */

const noop = (): void => undefined;
function makeLogger() {
  const l = {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => l,
  };
  return l;
}

const MENSAJE = {
  to: 'fvp@live.cl',
  subject: 'Activa tu cuenta de conductor',
  text: 'Tu PIN es 123456',
  html: '<p>Tu PIN es 123456</p>',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('crearEmailSender', () => {
  it('sin API key devuelve el logger, no revienta el arranque', () => {
    const logger = makeLogger();
    const sender = crearEmailSender({ apiKey: undefined, from: 'x@y.cl', logger: logger as never });
    expect(sender).toBeInstanceOf(LoggingEmailSender);
    // Tiene que ser RUIDOSO: si nadie avisa, el PO cree que los correos salen.
    expect(logger.warn).toHaveBeenCalled();
  });

  it('con API key devuelve el sender real', () => {
    const sender = crearEmailSender({
      apiKey: 're_test_key',
      from: 'x@y.cl',
      logger: makeLogger() as never,
    });
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });
});

describe('LoggingEmailSender', () => {
  it('registra el correo que HABRÍA salido y reporta que no se envió', async () => {
    const logger = makeLogger();
    const r = await new LoggingEmailSender(logger as never).send(MENSAJE);
    expect(r.enviado).toBe(false);
    if (r.enviado) {
      throw new Error('esperaba fallo');
    }
    expect(r.motivo).toBe('sin_proveedor');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('NUNCA loguea el cuerpo del mensaje', async () => {
    // El cuerpo lleva el PIN de activación. Un log estructurado se replica a
    // Cloud Logging y queda accesible a cualquiera con read en el proyecto.
    const logger = makeLogger();
    await new LoggingEmailSender(logger as never).send(MENSAJE);
    const loggeado = JSON.stringify(logger.warn.mock.calls);
    expect(loggeado).not.toContain('123456');
    expect(loggeado).not.toContain(MENSAJE.text);
    expect(loggeado).not.toContain(MENSAJE.html);
    // El destinatario y el asunto sí, que son los que permiten diagnosticar.
    expect(loggeado).toContain('fvp@live.cl');
  });
});

describe('ResendEmailSender', () => {
  it('hace POST a la API de Resend con el bearer y el payload correctos', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg-1' }),
      text: async () => '{"id":"msg-1"}',
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await new ResendEmailSender({
      apiKey: 're_test_key',
      from: 'Booster <no-reply@boosterchile.com>',
      logger: makeLogger() as never,
    }).send(MENSAJE);

    expect(r.enviado).toBe(true);
    // Estrechar la unión antes de leer `id`: el tipo es discriminado por
    // `enviado`, que es justamente lo que obliga a manejar el fallo.
    if (!r.enviado) {
      throw new Error('esperaba envío exitoso');
    }
    expect(r.id).toBe('msg-1');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual(
      expect.objectContaining({
        from: 'Booster <no-reply@boosterchile.com>',
        to: ['fvp@live.cl'],
        subject: MENSAJE.subject,
      }),
    );
  });

  it('un 4xx de Resend NO lanza: devuelve enviado=false', async () => {
    // Quien llama a esto está cerrando un alta. Si un correo caído voltea la
    // operación, el conductor queda a medio crear por un problema de un
    // proveedor externo.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => '{"message":"domain not verified"}',
      }),
    );
    const logger = makeLogger();
    const r = await new ResendEmailSender({
      apiKey: 're_k',
      from: 'x@y.cl',
      logger: logger as never,
    }).send(MENSAJE);

    expect(r.enviado).toBe(false);
    if (r.enviado) {
      throw new Error('esperaba fallo');
    }
    expect(r.motivo).toBe('error_proveedor');
    // Pero NO en silencio: un catch que traga es peor que el fallo.
    expect(logger.error).toHaveBeenCalled();
  });

  it('una caída de red tampoco lanza', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const logger = makeLogger();
    const r = await new ResendEmailSender({
      apiKey: 're_k',
      from: 'x@y.cl',
      logger: logger as never,
    }).send(MENSAJE);
    expect(r.enviado).toBe(false);
    if (r.enviado) {
      throw new Error('esperaba fallo');
    }
    expect(r.motivo).toBe('error_red');
    expect(logger.error).toHaveBeenCalled();
  });

  it('el error del proveedor no arrastra el cuerpo al log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }),
    );
    const logger = makeLogger();
    await new ResendEmailSender({
      apiKey: 're_k',
      from: 'x@y.cl',
      logger: logger as never,
    }).send(MENSAJE);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('123456');
  });

  it('la API key nunca aparece en un log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }),
    );
    const logger = makeLogger();
    await new ResendEmailSender({
      apiKey: 're_super_secreta',
      from: 'x@y.cl',
      logger: logger as never,
    }).send(MENSAJE);
    const todo = JSON.stringify([
      logger.error.mock.calls,
      logger.warn.mock.calls,
      logger.info.mock.calls,
    ]);
    expect(todo).not.toContain('re_super_secreta');
  });
});
