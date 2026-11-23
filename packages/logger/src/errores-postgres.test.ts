import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './createLogger.js';
import { registrarErroresDePool } from './error-reporting.js';

/**
 * Spec `.specs/errores-conexion-postgres`: un corte de conexión a Postgres no
 * debe tumbar el proceso, y el error que llega al log debe conservar su causa
 * sin los valores de la consulta.
 */

/** Misma forma que `DrizzleQueryError` de drizzle-orm 0.45 (errors.js). */
class ErrorDeConsulta extends Error {
  query: string;
  params: unknown[];
  constructor(query: string, params: unknown[], cause: Error) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.query = query;
    this.params = params;
    this.cause = cause;
  }
}

const IMEI = '356307042441013';
const LATITUD = -33.456789;

function errorDeInsert(): ErrorDeConsulta {
  const causa = Object.assign(new Error('Connection terminated unexpectedly'), {
    code: 'ECONNRESET',
  });
  return new ErrorDeConsulta(
    'INSERT INTO telemetria_puntos (imei, latitud) VALUES ($1, $2)',
    [IMEI, LATITUD],
    causa,
  );
}

describe('errores de Postgres en el log', () => {
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

  const ultimaLinea = (): string => captured[captured.length - 1] ?? '{}';
  const ultima = (): Record<string, unknown> => JSON.parse(ultimaLinea());

  it('conserva tipo, mensaje y causa del error', () => {
    const logger = createLogger({ service: 'telemetry-processor' });
    logger.error({ err: errorDeInsert() }, 'error procesando');
    const err = ultima().err as Record<string, unknown>;
    expect(err.type).toBe('Error');
    expect(String(err.message)).toContain('Failed query: INSERT INTO telemetria_puntos');
    expect(String(err.stack)).toContain('Failed query');
    expect(err.query).toBe('INSERT INTO telemetria_puntos (imei, latitud) VALUES ($1, $2)');
    const causa = err.cause as Record<string, unknown>;
    expect(causa.message).toBe('Connection terminated unexpectedly');
    expect(causa.code).toBe('ECONNRESET');
    expect(String(causa.stack)).toContain('Connection terminated unexpectedly');
  });

  it('no escribe los valores de la consulta en ningún campo', () => {
    const logger = createLogger({ service: 'telemetry-processor' });
    logger.error({ err: errorDeInsert() }, 'error procesando');
    const linea = ultimaLinea();
    expect(linea).not.toContain(IMEI);
    expect(linea).not.toContain(String(LATITUD));
    const entrada = ultima();
    expect((entrada.err as Record<string, unknown>).params).toBe('[omitidos: 2]');
    expect(String(entrada.stack_trace)).toContain('params: [omitidos: 2]');
  });

  it('el Error como primer argumento también sale sin valores', () => {
    const logger = createLogger({ service: 'api' });
    logger.fatal(errorDeInsert());
    const linea = ultimaLinea();
    expect(linea).not.toContain(IMEI);
    expect(String(ultima().stack_trace)).toContain('Failed query');
  });

  it('una causa que se referencia a sí misma no cuelga el log', () => {
    const logger = createLogger({ service: 'api' });
    const err = new Error('ciclo');
    err.cause = err;
    logger.error({ err }, 'ciclo');
    expect((ultima().err as Record<string, unknown>).message).toBe('ciclo');
  });

  it('un error común conserva mensaje y stack', () => {
    const logger = createLogger({ service: 'api' });
    logger.error({ err: new TypeError('x es undefined') }, 'falló');
    const err = ultima().err as Record<string, unknown>;
    expect(err.type).toBe('TypeError');
    expect(err.message).toBe('x es undefined');
    expect(err.cause).toBeUndefined();
  });
});

describe('registrarErroresDePool', () => {
  it('sin registrar, un error del pool es una excepción no controlada', () => {
    const pool = new EventEmitter();
    expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).toThrow(
      'Connection terminated unexpectedly',
    );
  });

  it('registrado, el error del pool no lanza y queda como warn', () => {
    const pool = new EventEmitter();
    const warn = vi.fn();
    registrarErroresDePool(pool, { warn });
    const err = new Error('Connection terminated unexpectedly');
    expect(() => pool.emit('error', err)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ err });
  });
});
