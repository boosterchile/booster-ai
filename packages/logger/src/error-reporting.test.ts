import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './createLogger.js';
import { REPORTED_ERROR_EVENT_TYPE, registrarErroresNoControlados } from './error-reporting.js';

/**
 * T10-16 (ADR-082): Error Reporting agrupa una entrada de Cloud Logging solo
 * si trae el stack en un campo de primer nivel (`stack_trace`) o el `@type`
 * ReportedErrorEvent. Pino deja el stack anidado en `err.stack`, así que hasta
 * ahora ningún error de backend llegaba al agregador.
 */
describe('formato Error Reporting', () => {
  const captured: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captured.length = 0;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });
  afterEach(() => writeSpy.mockRestore());

  const last = (): Record<string, unknown> => JSON.parse(captured[captured.length - 1] ?? '{}');

  it('logger.error({ err }) agrega @type, stack_trace y serviceContext', () => {
    const logger = createLogger({ service: 'api', version: '1.2.3' });
    const err = new Error('boom');
    logger.error({ err }, 'falló algo');
    const entry = last();
    expect(entry['@type']).toBe(REPORTED_ERROR_EVENT_TYPE);
    expect(String(entry.stack_trace)).toContain('Error: boom');
    expect(entry.serviceContext).toEqual({ service: 'api', version: '1.2.3' });
    expect(entry.severity).toBe('ERROR');
  });

  it('logger.fatal(err) con el Error como primer argumento también se reporta', () => {
    const logger = createLogger({ service: 'whatsapp-bot' });
    logger.fatal(new TypeError('x es undefined'));
    expect(String(last().stack_trace)).toContain('TypeError: x es undefined');
  });

  it('warn con err y error sin Error NO se reportan (no son fallas no controladas)', () => {
    const logger = createLogger({ service: 'api' });
    logger.warn({ err: new Error('esperado') }, 'reintento');
    expect(last()['@type']).toBeUndefined();
    logger.error({ motivo: 'sin stack' }, 'error de negocio');
    expect(last()['@type']).toBeUndefined();
  });
});

describe('registrarErroresNoControlados', () => {
  it('uncaughtException y unhandledRejection se loguean como fatal con stack y salen con 1', () => {
    const fatal = vi.fn();
    const exit = vi.fn();
    const handlers = new Map<string, (arg: unknown) => void>();
    registrarErroresNoControlados({ fatal } as never, {
      exit,
      on: (evento, handler) => {
        handlers.set(evento, handler);
      },
    });

    const err = new Error('no capturado');
    handlers.get('uncaughtException')?.(err);
    expect(fatal).toHaveBeenLastCalledWith({ err }, 'uncaughtException');
    expect(exit).toHaveBeenLastCalledWith(1);

    handlers.get('unhandledRejection')?.('motivo string');
    const [payload, msg] = fatal.mock.calls[1] ?? [];
    expect(msg).toBe('unhandledRejection');
    expect((payload as { err: Error }).err).toBeInstanceOf(Error);
    expect((payload as { err: Error }).err.message).toBe('motivo string');
    expect(exit).toHaveBeenCalledTimes(2);
  });
});
