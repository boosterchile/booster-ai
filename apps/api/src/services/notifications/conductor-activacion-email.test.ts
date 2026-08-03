import { describe, expect, it, vi } from 'vitest';
import { enviarCorreoActivacionConductor } from './conductor-activacion-email.js';
import type { EmailSender } from './email-sender.js';

/**
 * El correo que Javier Poblete nunca recibió (incidente prod 2026-08-03).
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

/** El mensaje que se intentó enviar. Falla el test si no hubo ninguno. */
function primerMensaje(send: ReturnType<typeof vi.fn>) {
  const call = send.mock.calls[0];
  if (!call) {
    throw new Error('no se llamó al sender');
  }
  return call[0] as { to: string; subject: string; text: string; html: string };
}

const BASE = {
  email: 'fvp@live.cl',
  nombre: 'Javier Poblete',
  rut: '5864136-7',
  pin: '482915',
  empresa: 'Transportes Van Oosterwyk',
  webAppUrl: 'https://app.boosterchile.com',
};

describe('enviarCorreoActivacionConductor', () => {
  it('manda al conductor el enlace de activación con su RUT precargado', async () => {
    const { sender, send } = makeSender();
    await enviarCorreoActivacionConductor({ sender, logger: makeLogger() as never, ...BASE });

    const msg = primerMensaje(send);
    expect(msg.to).toBe('fvp@live.cl');
    expect(msg.text).toContain('https://app.boosterchile.com/login/conductor?rut=5864136-7');
    expect(msg.html).toContain('https://app.boosterchile.com/login/conductor?rut=5864136-7');
  });

  it('incluye el PIN y nombra a la empresa que lo dio de alta', async () => {
    const { sender, send } = makeSender();
    await enviarCorreoActivacionConductor({ sender, logger: makeLogger() as never, ...BASE });

    const msg = primerMensaje(send);
    expect(msg.text).toContain('482915');
    // Que sepa quién lo inscribió: si no reconoce la empresa, es phishing.
    expect(msg.text).toContain('Transportes Van Oosterwyk');
    expect(msg.subject.toLowerCase()).toContain('activa');
  });

  it('le dice que va a crear SU clave, no que use el PIN para entrar', async () => {
    // El PIN sirve una vez. Confundirlo con la credencial es el error que ya
    // costó la reescritura de /login/conductor.
    const { sender, send } = makeSender();
    await enviarCorreoActivacionConductor({ sender, logger: makeLogger() as never, ...BASE });
    expect(primerMensaje(send).text).toMatch(/tu propia clave|crear.*clave/i);
  });

  it('si el envío falla NO lanza — el alta ya ocurrió', async () => {
    const { sender } = makeSender({ enviado: false, motivo: 'error_proveedor' } as never);
    const logger = makeLogger();
    await expect(
      enviarCorreoActivacionConductor({ sender, logger: logger as never, ...BASE }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('si el sender lanza, tampoco propaga', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const logger = makeLogger();
    await expect(
      enviarCorreoActivacionConductor({
        sender: { send } as unknown as EmailSender,
        logger: logger as never,
        ...BASE,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('el PIN nunca se loguea', async () => {
    const { sender } = makeSender({ enviado: false, motivo: 'error_proveedor' } as never);
    const logger = makeLogger();
    await enviarCorreoActivacionConductor({ sender, logger: logger as never, ...BASE });
    const todo = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(todo).not.toContain('482915');
  });
});
