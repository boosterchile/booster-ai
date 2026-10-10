import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { crearManejadorMensajes } from './consumer.js';

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

function mensaje() {
  return {
    id: 'm-1',
    data: Buffer.from('{}'),
    ackWithResponse: vi.fn().mockResolvedValue(undefined),
    nack: vi.fn(),
  };
}

describe('crearManejadorMensajes', () => {
  it('resultado terminal → ack confirmado', async () => {
    const log = makeLogger();
    const procesar = vi.fn().mockResolvedValue('enviado');
    const manejar = crearManejadorMensajes({ procesar, logger: log as never as Logger });
    const m = mensaje();

    await manejar(m);

    expect(procesar).toHaveBeenCalledWith(m.data);
    expect(m.ackWithResponse).toHaveBeenCalledOnce();
    expect(m.nack).not.toHaveBeenCalled();
  });

  it('error transitorio → nack (reintento, DLQ tras 5)', async () => {
    const log = makeLogger();
    const manejar = crearManejadorMensajes({
      procesar: vi.fn().mockRejectedValue(new Error('twilio 503')),
      logger: log as never as Logger,
    });
    const m = mensaje();

    await manejar(m);

    expect(m.nack).toHaveBeenCalledOnce();
    expect(m.ackWithResponse).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm-1' }),
      'error transitorio procesando notification-events, nack para reintento',
    );
  });

  it('ack fallido tras un envío: se loguea (posible duplicado) sin lanzar', async () => {
    const log = makeLogger();
    const manejar = crearManejadorMensajes({
      procesar: vi.fn().mockResolvedValue('enviado'),
      logger: log as never as Logger,
    });
    const m = mensaje();
    m.ackWithResponse.mockRejectedValueOnce(new Error('ack expired'));

    await expect(manejar(m)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm-1', resultado: 'enviado' }),
      'ack fallido tras envío',
    );
  });
});
