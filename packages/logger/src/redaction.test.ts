import { Writable } from 'node:stream';
import { type Logger as PinoLogger, pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { redactionPaths } from './redaction.js';

/**
 * Tests para T-SEC-032a (security-blocking-hotfixes-2026-05-14, plan v3.3).
 *
 * Verifica:
 *  1. Las 12 keys de PII top-level se redactan a `[REDACTED]` cuando aparecen en
 *     la raíz del objeto loggeado (regresión SEC-032).
 *  2. Los wildcards `*.email`, `*.rut`, etc. siguen redactando anidados.
 *  3. NO-REDACT policy: `userId`, `uid`, `messageId`, `ip`, `userAgent`, `path`
 *     no se redactan (pseudonymización + audit trail Ley 19.628 art. 2 lit. f).
 *  4. Pino snapshot fixture — detecta drift de Pino upstream en redact semantics.
 *
 * No se usa createLogger() acá porque las opciones (transport, formatters) están
 * acopladas a Cloud Logging. Estos tests verifican la unidad redactionPaths +
 * Pino redact engine. Tests de integración con createLogger viven en
 * createLogger.test.ts (T-SEC-032b).
 */

/** Crea un logger Pino fresh con redactionPaths aplicados y captura el JSON output. */
function captureLog(loggerFn: (logger: PinoLogger) => void): Record<string, unknown> {
  let captured = '';
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      captured += chunk.toString();
      cb();
    },
  });
  const logger = pino(
    {
      level: 'info',
      base: { service: 'test', version: '0.0.0-dev' },
      formatters: {
        level: (label, number) => ({ severity: pinoLevelToGcpSeverity(label), level: number }),
      },
      redact: { paths: redactionPaths, censor: '[REDACTED]' },
      messageKey: 'message',
    },
    sink,
  );
  loggerFn(logger);
  const lines = captured.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    throw new Error('no log line captured');
  }
  return JSON.parse(lines[lines.length - 1] as string);
}

/** Replica del mapping en createLogger.ts para que la snapshot sea estable. */
function pinoLevelToGcpSeverity(label: string): string {
  switch (label) {
    case 'trace':
    case 'debug':
      return 'DEBUG';
    case 'info':
      return 'INFO';
    case 'warn':
      return 'WARNING';
    case 'error':
      return 'ERROR';
    case 'fatal':
      return 'CRITICAL';
    default:
      return 'DEFAULT';
  }
}

const PII_BARE_KEYS = [
  'email',
  'rut',
  'phone',
  'phone_number',
  'phoneNumber',
  'whatsapp_e164',
  'whatsappE164',
  'full_name',
  'fullName',
  'dni',
  'firebase_uid',
  'firebaseUid',
] as const;

const PII_SAMPLE_VALUE = 'sensitive-value-do-not-leak';

describe('redactionPaths — SEC-032 top-level PII keys (T-SEC-032a)', () => {
  it.each(PII_BARE_KEYS)('redacts top-level key "%s" to [REDACTED]', (key) => {
    const out = captureLog((logger) => {
      logger.info({ [key]: PII_SAMPLE_VALUE }, 'pii test');
    });
    expect(out[key]).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain(PII_SAMPLE_VALUE);
  });

  it('redacts multiple top-level PII keys in a single log line', () => {
    const out = captureLog((logger) => {
      logger.info(
        { rut: '12345678-9', email: 'demo@booster.invalid', firebaseUid: 'uid-abc-123' },
        'multi pii',
      );
    });
    expect(out.rut).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
    expect(out.firebaseUid).toBe('[REDACTED]');
  });

  it('regression — still redacts nested via *.email wildcard', () => {
    const out = captureLog((logger) => {
      logger.info({ user: { email: PII_SAMPLE_VALUE } }, 'nested email');
    });
    const user = out.user as { email: string };
    expect(user.email).toBe('[REDACTED]');
  });

  it('combination — top-level + nested in same log both redacted', () => {
    const out = captureLog((logger) => {
      logger.info({ email: PII_SAMPLE_VALUE, user: { rut: '12345678-9' } }, 'top+nested');
    });
    expect(out.email).toBe('[REDACTED]');
    const user = out.user as { rut: string };
    expect(user.rut).toBe('[REDACTED]');
  });
});

describe('redactionPaths — SEC-032 NO-REDACT exemption (T-SEC-032a)', () => {
  /**
   * Ley 19.628 art. 2 lit. f: identificadores sintéticos (UUIDs) son
   * pseudonimización aceptable. SEC-033 explícito: IPs y UserAgents son
   * evidencia de incident response, no PII a redactar.
   */
  const NON_PII_KEYS_WITH_VALUES = {
    userId: 'usr-uuid-aaaa-bbbb',
    uid: 'firebase-uid-not-the-pii-flavor',
    messageId: 'msg-uuid-ffff',
    ip: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (Test)',
    path: '/me/profile',
  };

  it.each(Object.entries(NON_PII_KEYS_WITH_VALUES))(
    'does NOT redact operational key "%s"',
    (key, value) => {
      const out = captureLog((logger) => {
        logger.info({ [key]: value }, 'non-pii');
      });
      expect(out[key]).toBe(value);
    },
  );

  it('Pino metadata (severity, service, version) stays in clear', () => {
    const out = captureLog((logger) => {
      logger.info('just a message');
    });
    expect(out.service).toBe('test');
    expect(out.version).toBe('0.0.0-dev');
    expect(out.severity).toBe('INFO');
  });
});

describe('redactionPaths — Pino upstream snapshot (T-SEC-032a, OBJ-9 mitigation)', () => {
  /**
   * Fixture-based snapshot: si Pino bumpea entre 9.5.x y 9.999.x y cambia
   * sutilmente la semántica de redact.paths, este test atrapa la regresión.
   * Strippeamos `time` y `pid`/`hostname` que son no-determinísticos.
   */
  it('emits stable JSON shape for canonical input fixture', () => {
    const out = captureLog((logger) => {
      logger.info(
        {
          email: 'pii@example.com',
          rut: '12345678-9',
          userId: 'usr-1234',
          user: { phone: '+56912345678' },
        },
        'canonical fixture',
      );
    });
    const stable = { ...out };
    // biome-ignore lint/performance/noDelete: explicit non-determinism strip
    delete (stable as { time?: unknown }).time;
    // biome-ignore lint/performance/noDelete: explicit non-determinism strip
    delete (stable as { pid?: unknown }).pid;
    // biome-ignore lint/performance/noDelete: explicit non-determinism strip
    delete (stable as { hostname?: unknown }).hostname;
    expect(stable).toEqual({
      severity: 'INFO',
      level: 30,
      service: 'test',
      version: '0.0.0-dev',
      email: '[REDACTED]',
      rut: '[REDACTED]',
      userId: 'usr-1234',
      user: { phone: '[REDACTED]' },
      message: 'canonical fixture',
    });
  });

  it('redactionPaths exports all 12 canonical bare PII keys', () => {
    for (const key of PII_BARE_KEYS) {
      expect(redactionPaths).toContain(key);
    }
  });
});
