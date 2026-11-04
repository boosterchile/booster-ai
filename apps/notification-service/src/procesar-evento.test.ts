import type { Logger } from '@booster-ai/logger';
import { TwilioApiError, hashTwilioContentForm } from '@booster-ai/whatsapp-client';
import { describe, expect, it, vi } from 'vitest';
import { procesarEventoNotificacion } from './procesar-evento.js';

const noop = (): void => undefined;
function makeLogger() {
  return {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => makeLogger(),
  };
}

const FROM = '+19383365293';
const base = {
  version: 1,
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  canal: 'whatsapp_template',
  modo: 'enviar',
  destinatario: '+56957790379',
  contentSid: 'HX00000000000000000000000000000001',
  variables: { '1': 'BOO-1' },
  emitidoEn: '2026-10-08T12:00:00.000Z',
};
const hashDe = (from: string) =>
  hashTwilioContentForm({
    fromNumber: from,
    to: base.destinatario,
    contentSid: base.contentSid,
    contentVariables: base.variables,
  });

function setup() {
  const log = makeLogger();
  const sender = { sendContent: vi.fn().mockResolvedValue({ sid: 'SM1' }) };
  const procesar = (evento: unknown) =>
    procesarEventoNotificacion({
      data: Buffer.from(typeof evento === 'string' ? evento : JSON.stringify(evento)),
      sender,
      fromNumber: FROM,
      logger: log as never as Logger,
    });
  return { log, sender, procesar };
}

describe('procesarEventoNotificacion', () => {
  it('modo enviar: entrega el template con destinatario, SID y variables del evento', async () => {
    const { sender, procesar, log } = setup();
    await expect(procesar(base)).resolves.toBe('enviado');
    expect(sender.sendContent).toHaveBeenCalledWith({
      to: base.destinatario,
      contentSid: base.contentSid,
      contentVariables: base.variables,
    });
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: base.idempotencyKey, twilioSid: 'SM1' }),
      'notificacion enviada',
    );
  });

  it('modo sombra con el mismo sender: coincide y nunca envía', async () => {
    const { sender, procesar, log } = setup();
    await expect(procesar({ ...base, modo: 'sombra', hashEsperado: hashDe(FROM) })).resolves.toBe(
      'sombra_coincide',
    );
    expect(sender.sendContent).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: base.idempotencyKey }),
      'notificacion sombra coincide',
    );
  });

  it('modo sombra con otro sender en el api: diverge (warn) y nunca envía', async () => {
    const { sender, procesar, log } = setup();
    await expect(
      procesar({ ...base, modo: 'sombra', hashEsperado: hashDe('+10000000000') }),
    ).resolves.toBe('sombra_diverge');
    expect(sender.sendContent).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ hashEsperado: hashDe('+10000000000'), hashServicio: hashDe(FROM) }),
      'notificacion sombra diverge',
    );
  });

  it('JSON inválido o payload fuera de contrato: descartado sin reintento', async () => {
    const { sender, procesar, log } = setup();
    await expect(procesar('{no-json')).resolves.toBe('descartado');
    await expect(procesar({ ...base, contentSid: 'XX' })).resolves.toBe('descartado');
    expect(sender.sendContent).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('Twilio 4xx (no 429): rechazado por el proveedor, sin reintento', async () => {
    const { sender, procesar, log } = setup();
    sender.sendContent.mockRejectedValueOnce(new TwilioApiError('bad', 400, { code: 21211 }));
    await expect(procesar(base)).resolves.toBe('rechazado_proveedor');
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 400 }),
      'notificacion rechazada por Twilio (no se reintenta)',
    );
  });

  it('Twilio 429, 5xx o error de red: propaga para nack y reintento', async () => {
    const { sender, procesar } = setup();
    sender.sendContent.mockRejectedValueOnce(new TwilioApiError('rate', 429, {}));
    await expect(procesar(base)).rejects.toThrow('rate');
    sender.sendContent.mockRejectedValueOnce(new TwilioApiError('down', 503, {}));
    await expect(procesar(base)).rejects.toThrow('down');
    sender.sendContent.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(procesar(base)).rejects.toThrow('ECONNRESET');
  });
});
