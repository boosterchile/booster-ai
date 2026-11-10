import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { enviarAvisoAccesoPanel } from './aviso-acceso-panel-email.js';
import type { EmailSender } from './email-sender.js';

/**
 * `.specs/acceso-panel-plataforma` SC5 — cada alta que otorga acceso al panel
 * y cada baja avisan a los correos de la lista de respaldo.
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

function makeSender(impl?: EmailSender['send']) {
  const send = vi.fn<EmailSender['send']>(impl ?? (async () => ({ enviado: true, id: 'm-1' })));
  return { sender: { send } as EmailSender, send };
}

const BASE = {
  persona: { userId: 'u-ana', nombre: 'Ana Soto', email: 'ana.soto@boosterchile.com' },
  actorEmail: 'dev@boosterchile.com',
  webAppUrl: 'https://app.boosterchile.com/',
};

describe('enviarAvisoAccesoPanel', () => {
  it('avisa a cada correo de la lista, una vez y en minúsculas', async () => {
    const { sender, send } = makeSender();
    const logger = makeLogger();

    const r = await enviarAvisoAccesoPanel({
      ...BASE,
      sender,
      logger: logger as never as Logger,
      accion: 'otorgado',
      destinatarios: ['dev@boosterchile.com', ' DEV@boosterchile.com', 'ops@boosterchile.com', ''],
    });

    expect(send.mock.calls.map((c) => c[0].to)).toEqual([
      'dev@boosterchile.com',
      'ops@boosterchile.com',
    ]);
    expect(r).toEqual({ destinatarios: 2, enviados: 2 });
  });

  it('el aviso de alta dice quién otorgó el acceso, a quién y dónde se quita', async () => {
    const { sender, send } = makeSender();

    await enviarAvisoAccesoPanel({
      ...BASE,
      sender,
      logger: makeLogger() as never as Logger,
      accion: 'otorgado',
      destinatarios: ['dev@boosterchile.com'],
    });

    const msg = send.mock.calls[0]?.[0];
    expect(msg?.subject).toBe('Booster: acceso al panel otorgado a Ana Soto');
    expect(msg?.text).toContain('dev@boosterchile.com');
    expect(msg?.text).toContain('Ana Soto (ana.soto@boosterchile.com)');
    expect(msg?.text).toContain('https://app.boosterchile.com/app/platform-admin/personal');
    expect(msg?.html).toBeUndefined();
  });

  it('el aviso de baja dice que el acceso se quitó', async () => {
    const { sender, send } = makeSender();

    await enviarAvisoAccesoPanel({
      ...BASE,
      sender,
      logger: makeLogger() as never as Logger,
      accion: 'quitado',
      destinatarios: ['dev@boosterchile.com'],
    });

    const msg = send.mock.calls[0]?.[0];
    expect(msg?.subject).toBe('Booster: acceso al panel quitado a Ana Soto');
    expect(msg?.text).toContain('quitó el acceso');
  });

  it('sin lista de respaldo no envía nada', async () => {
    const { sender, send } = makeSender();

    const r = await enviarAvisoAccesoPanel({
      ...BASE,
      sender,
      logger: makeLogger() as never as Logger,
      accion: 'otorgado',
      destinatarios: [],
    });

    expect(send).not.toHaveBeenCalled();
    expect(r).toEqual({ destinatarios: 0, enviados: 0 });
  });

  it('un correo que no sale queda registrado y no corta los demás', async () => {
    const { sender, send } = makeSender(async (msg) =>
      msg.to === 'dev@boosterchile.com'
        ? { enviado: false, motivo: 'error_proveedor' }
        : { enviado: true, id: 'm-2' },
    );
    const logger = makeLogger();

    const r = await enviarAvisoAccesoPanel({
      ...BASE,
      sender,
      logger: logger as never as Logger,
      accion: 'quitado',
      destinatarios: ['dev@boosterchile.com', 'ops@boosterchile.com'],
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ destinatarios: 2, enviados: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-ana', motivo: 'error_proveedor' }),
      expect.any(String),
    );
  });

  it('un sender que lanza queda registrado sin el mensaje del proveedor', async () => {
    const { sender } = makeSender(async () => {
      throw new Error('fallo con datos del cuerpo');
    });
    const logger = makeLogger();

    const r = await enviarAvisoAccesoPanel({
      ...BASE,
      sender,
      logger: logger as never as Logger,
      accion: 'otorgado',
      destinatarios: ['dev@boosterchile.com'],
    });

    expect(r).toEqual({ destinatarios: 1, enviados: 0 });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('fallo con datos del cuerpo');
  });
});
