import { trace } from '@opentelemetry/api';
import { type Logger as PinoLogger, type LoggerOptions as PinoOptions, pino } from 'pino';
import { redactObjectValues, redactValue, redactionPaths } from './redaction.js';

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
  /**
   * Project ID de GCP para la correlación nativa log↔trace en Cloud
   * Logging (`logging.googleapis.com/trace`). Default:
   * GOOGLE_CLOUD_PROJECT del env — los 5 servicios la tienen en prod,
   * así que la correlación funciona sin tocar los call-sites.
   */
  gcpProjectId?: string;
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
    gcpProjectId,
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
      // T4 SC-H4.1: value-based PII redaction sobre el log record entero.
      // Complementa path-based redact (arriba): cubre PII en strings libres
      // y en keys no allowlisted (e.g. `customApiSecret`, mensaje con email).
      log: (obj) => redactObjectValues(obj) as Record<string, unknown>,
    },
    redact: {
      paths: [...redactionPaths, ...additionalRedactionPaths],
      censor: '[REDACTED]',
    },
    // T4 SC-H4.1: intercepta string args (message + format args) ANTES del
    // serialize de Pino para aplicar value-based regex redaction. Complementa
    // formatters.log que cubre el object payload.
    hooks: {
      logMethod(inputArgs, method) {
        const out = inputArgs.map((a) => (typeof a === 'string' ? redactValue(a) : a));
        return method.apply(this, out as Parameters<typeof method>);
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    // Correlación de traces (spec feat-otel-bootstrap): el docstring de
    // este package PROMETÍA trace desde OTel context y nunca existió
    // (auditoría 2026-06-09). Con un span activo, cada log lleva
    // trace_id/span_id + los campos especiales que Cloud Logging usa
    // para agrupar logs por trace en la consola. Sin span: cero ruido.
    mixin: () => {
      const span = trace.getActiveSpan();
      if (!span) {
        return {};
      }
      const ctx = span.spanContext();
      const projectId = gcpProjectId ?? process.env.GOOGLE_CLOUD_PROJECT;
      return {
        trace_id: ctx.traceId,
        span_id: ctx.spanId,
        ...(projectId
          ? {
              'logging.googleapis.com/trace': `projects/${projectId}/traces/${ctx.traceId}`,
              'logging.googleapis.com/spanId': ctx.spanId,
            }
          : {}),
      };
    },
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
