import { type Logger as PinoLogger, type LoggerOptions as PinoOptions, pino } from 'pino';
import { redactionPaths } from './redaction.js';

export type Logger = PinoLogger;

export interface LoggerOptions {
  /** Nombre del servicio (aparecerá en cada log) */
  service: string;
  /** Versión del servicio */
  version?: string;
  /** Nivel de logging (default: info) */
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Si true, usa pino-pretty para output legible (solo dev) */
  pretty?: boolean;
  /** Redaction paths adicionales específicos del servicio */
  additionalRedactionPaths?: string[];
}

/**
 * Crea un logger Pino configurado para Booster AI.
 *
 * En Cloud Run, el output JSON se mapea automáticamente a fields de
 * Cloud Logging. El campo `severity` se deriva del level de Pino.
 * El campo `trace` se popula desde OpenTelemetry context si existe.
 */
export function createLogger(options: LoggerOptions): Logger {
  const {
    service,
    version = '0.0.0-dev',
    level = 'info',
    pretty = false,
    additionalRedactionPaths = [],
  } = options;

  const opts: PinoOptions = {
    level,
    base: {
      service,
      version,
    },
    formatters: {
      // Mapear level a severity para Cloud Logging
      level: (label, number) => ({
        severity: pinoLevelToGcpSeverity(label),
        level: number,
      }),
    },
    redact: {
      paths: [...redactionPaths, ...additionalRedactionPaths],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
  };

  if (pretty) {
    return pino({
      ...opts,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(opts);
}

function pinoLevelToGcpSeverity(label: string): string {
  switch (label) {
    case 'trace':
      return 'DEBUG';
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
