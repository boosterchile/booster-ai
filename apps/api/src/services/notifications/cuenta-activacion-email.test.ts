import { describe, expect, it, vi } from 'vitest';
import { enviarCorreoActivacionCuenta } from './cuenta-activacion-email.js';
import type { EmailSender } from './email-sender.js';

/**
 * T10-04 (ADR-082) — el código de activación del dueño le llega a la persona,
 * no solo al admin que lo dio de alta.
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

function makeSender(result: unknown = { enviado: true, id: 'm-1' }) {
  const send = vi.fn().mockResolvedValue(result);
  return { sender: { send } as unknown as EmailSender, send };
}

function primerMensaje(send: ReturnType<typeof vi.fn>) {
  const call = send.mock.calls[0];
  if (!call) {
    throw new Error('no se llamó al sender');
  }
  return call[0] as { to: string; subject: string; text: string; html: string };
}

const BASE = {
  email: 'gestor@transjavier.cl',
  nombre: 'Javier Soto',
  rut: '12345678-5',
  codigo: '731904',
  empresa: 'Sociedad de Transportes TransJavier Limitada',
  rol: 'dueno' as const,
  webAppUrl: 'https://app.boosterchile.com/',
};

describe('enviarCorreoActivacionCuenta', () => {
  it('va al correo de la persona con el enlace a /activar', async () => {
    const { sender, send } = makeSender();
    await enviarCorreoActivacionCuenta({ sender, logger: makeLogger() as never, ...BASE });
    const msg = primerMensaje(send);
    expect(msg.to).toBe('gestor@transjavier.cl');
    expect(msg.text).toContain('https://app.boosterchile.com/activar');
    expect(msg.html).toContain('href="https://app.boosterchile.com/activar"');
  });

  it('incluye RUT, código, empresa y el rol en palabras', async () => {
    const { sender, send } = makeSender();
    await enviarCorreoActivacionCuenta({ sender, logger: makeLogger() as never, ...BASE });
    const msg = primerMensaje(send);
    for (const parte of ['12345678-5', '731904', 'TransJavier', 'dueña o dueño']) {
      expect(msg.text).toContain(parte);
    }
    expect(msg.subject).toBe('Activa tu cuenta en Booster');
  });

  it('dice que el código sirve una vez y que la clave la elige la persona', async () => {
    const { sender, send } = makeSender();
    await enviarCorreoActivacionCuenta({ sender, logger: makeLogger() as never, ...BASE });
    const { text } = primerMensaje(send);
    expect(text).toContain('sirve una sola vez');
    expect(text).toContain('solo sabes tú');
  });

  it('escapa el HTML de nombre y empresa', async () => {
    const { sender, send } = makeSender();
    await enviarCorreoActivacionCuenta({
      sender,
      logger: makeLogger() as never,
      ...BASE,
      nombre: '<script>x</script>',
      empresa: 'A & B "Ltda"',
    });
    const { html } = primerMensaje(send);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('A &amp; B &quot;Ltda&quot;');
  });

  it('si el envío falla no lanza y avisa por warn', async () => {
    const { sender } = makeSender({ enviado: false, motivo: 'sin_proveedor' });
    const logger = makeLogger();
    await expect(
      enviarCorreoActivacionCuenta({ sender, logger: logger as never, ...BASE }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('si el sender lanza no propaga y registra error', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const logger = makeLogger();
    await expect(
      enviarCorreoActivacionCuenta({
        sender: { send } as unknown as EmailSender,
        logger: logger as never,
        ...BASE,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('un rechazo que no es Error también se registra sin propagar', async () => {
    const send = vi.fn().mockRejectedValue('timeout');
    const logger = makeLogger();
    await expect(
      enviarCorreoActivacionCuenta({
        sender: { send } as unknown as EmailSender,
        logger: logger as never,
        ...BASE,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'desconocido' }),
      expect.any(String),
    );
  });

  it('el código nunca se loguea', async () => {
    const { sender } = makeSender({ enviado: false, motivo: 'error_proveedor' });
    const logger = makeLogger();
    await enviarCorreoActivacionCuenta({ sender, logger: logger as never, ...BASE });
    const send2 = vi.fn().mockRejectedValue(new Error('731904'));
    await enviarCorreoActivacionCuenta({
      sender: { send: send2 } as unknown as EmailSender,
      logger: logger as never,
      ...BASE,
    });
    const todo = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(todo).not.toContain('731904');
  });
});
