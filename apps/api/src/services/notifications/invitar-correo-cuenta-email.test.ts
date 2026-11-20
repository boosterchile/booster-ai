import { describe, expect, it, vi } from 'vitest';
import type { EmailMessage, EmailSender } from './email-sender.js';
import { enviarCorreoInvitacionCrearCuenta } from './invitar-correo-cuenta-email.js';

describe('enviarCorreoInvitacionCrearCuenta', () => {
  it('envía From vía sender con enlace /crear-cuenta?token= y sin loguear el token', async () => {
    const send = vi.fn<EmailSender['send']>(async () => ({ enviado: true, id: 'm-1' }));
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const logger = { info, warn, error, child: () => logger } as never;

    await enviarCorreoInvitacionCrearCuenta({
      sender: { send },
      logger,
      invitacionId: '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d',
      email: 'gerencia@boosterchile.com',
      tipo: 'personal_booster',
      token: 'TOKEN_SECRETO_NO_LOG',
      webAppUrl: 'https://app.boosterchile.com/',
      expiraEn: new Date('2026-11-23T12:00:00.000Z'),
    });

    expect(send).toHaveBeenCalledOnce();
    const arg = send.mock.calls[0]?.[0] as EmailMessage | undefined;
    expect(arg).toBeDefined();
    expect(arg?.to).toBe('gerencia@boosterchile.com');
    expect(arg?.subject).toContain('personal de Booster');
    expect(arg?.text).toContain(
      'https://app.boosterchile.com/crear-cuenta?token=TOKEN_SECRETO_NO_LOG',
    );
    expect(arg?.html).toContain('/crear-cuenta?token=TOKEN_SECRETO_NO_LOG');
    expect(arg?.text).toContain('tipo «Booster»');
    // Los logs de éxito no existen; warn/error no se llaman con el token.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    for (const call of [...warn.mock.calls, ...error.mock.calls, ...info.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain('TOKEN_SECRETO_NO_LOG');
    }
  });

  it('no lanza si el sender falla', async () => {
    const send = vi.fn<EmailSender['send']>(async () => {
      throw new Error('red');
    });
    const error = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error, child: () => logger } as never;

    await expect(
      enviarCorreoInvitacionCrearCuenta({
        sender: { send },
        logger,
        invitacionId: '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d',
        email: 'a@b.cl',
        tipo: 'stakeholder',
        token: 'TOKEN_X',
        webAppUrl: 'https://app.example.com',
        expiraEn: new Date(),
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('TOKEN_X');
  });
});
