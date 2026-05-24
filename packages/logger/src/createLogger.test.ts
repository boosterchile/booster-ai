import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './createLogger.js';

describe('createLogger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const captured: string[] = [];

  beforeEach(() => {
    captured.length = 0;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  function lastLog(): Record<string, unknown> {
    const line = captured[captured.length - 1];
    if (!line) {
      throw new Error('no log captured');
    }
    return JSON.parse(line);
  }

  it('retorna un logger funcional con métodos pino estándar', () => {
    const logger = createLogger({ service: 'test-svc' });
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.trace).toBe('function');
  });

  it('inyecta service + version (defaults: 0.0.0-dev) en cada log', () => {
    const logger = createLogger({ service: 'api-test' });
    logger.info('hola');
    const log = lastLog();
    expect(log.service).toBe('api-test');
    expect(log.version).toBe('0.0.0-dev');
    expect(log.message).toBe('hola');
  });

  it('respeta version explícita', () => {
    const logger = createLogger({ service: 'api', version: '1.2.3' });
    logger.info('x');
    expect(lastLog().version).toBe('1.2.3');
  });

  it('respeta level explícito (warn descarta info)', () => {
    const logger = createLogger({ service: 's', level: 'warn' });
    logger.info('ignored');
    logger.warn('kept');
    const lines = captured.map((c) => JSON.parse(c));
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toBe('kept');
  });

  it('emite timestamp ISO 8601 (stdTimeFunctions.isoTime)', () => {
    const logger = createLogger({ service: 's' });
    logger.info('x');
    const log = lastLog();
    expect(log.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('mapea level a severity GCP en cada log (info→INFO, warn→WARNING, ...)', () => {
    const logger = createLogger({ service: 's', level: 'trace' });
    const cases: Array<[() => void, string]> = [
      [() => logger.trace('m'), 'DEBUG'],
      [() => logger.debug('m'), 'DEBUG'],
      [() => logger.info('m'), 'INFO'],
      [() => logger.warn('m'), 'WARNING'],
      [() => logger.error('m'), 'ERROR'],
      [() => logger.fatal('m'), 'CRITICAL'],
    ];
    for (const [emit, expectedSeverity] of cases) {
      captured.length = 0;
      emit();
      expect(lastLog().severity).toBe(expectedSeverity);
    }
  });

  it('redacta paths sensibles default (password, token, rut, email)', () => {
    const logger = createLogger({ service: 's' });
    logger.info(
      {
        user: {
          email: 'u@example.com',
          password: 'secret',
          rut: '11.111.111-1',
          token: 'abc',
        },
      },
      'login attempt',
    );
    const log = lastLog();
    const user = log.user as Record<string, string>;
    expect(user.email).toBe('[REDACTED]');
    expect(user.password).toBe('[REDACTED]');
    expect(user.rut).toBe('[REDACTED]');
    expect(user.token).toBe('[REDACTED]');
  });

  it('redacta paths adicionales via additionalRedactionPaths', () => {
    const logger = createLogger({
      service: 's',
      additionalRedactionPaths: ['*.internalId'],
    });
    logger.info({ user: { internalId: 'sensitive-12345' } }, 'evt');
    const user = lastLog().user as Record<string, string>;
    expect(user.internalId).toBe('[REDACTED]');
  });

  it('NO redacta campos no-sensibles (fullName_public no es PII path)', () => {
    const logger = createLogger({ service: 's' });
    logger.info({ user: { displayName: 'Juan' } }, 'evt');
    const user = lastLog().user as Record<string, string>;
    expect(user.displayName).toBe('Juan');
  });

  it('pretty=true retorna un logger funcional (transport pino-pretty)', () => {
    const logger = createLogger({ service: 's', pretty: true });
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  // --- T4 SC-H4.1: value-based redaction (regex sobre strings) ---

  it('value-redaction: redacta email inline en message string', () => {
    const logger = createLogger({ service: 's' });
    logger.info('signin from user@example.com');
    expect(lastLog().message).toBe('signin from [REDACTED:email]');
  });

  it('value-redaction: redacta RUT válido en field arbitrario (no en paths)', () => {
    const logger = createLogger({ service: 's' });
    logger.info({ note: 'cliente 11111111-1 consultó' }, 'lookup');
    expect(lastLog().note).toBe('cliente [REDACTED:rut] consultó');
  });

  it('value-redaction: redacta JWT inline en message', () => {
    const logger = createLogger({ service: 's' });
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSJ9.abc-signature';
    logger.info(`auth header: Bearer ${jwt}`);
    expect(lastLog().message).toBe('auth header: Bearer [REDACTED:jwt]');
  });

  it('value-redaction: key custom no-allowlisted con "secret" → [REDACTED:password]', () => {
    const logger = createLogger({ service: 's' });
    logger.info({ customApiSecret: 'abc123' }, 'evt');
    // path-based (Pino redact) no cubre `customApiSecret` literal,
    // pero value-redaction matchea la key con /secret/i.
    expect(lastLog().customApiSecret).toBe('[REDACTED:password]');
  });
});
