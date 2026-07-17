/**
 * Logger del frontend web (PWA).
 *
 * Punto único de control para logging del cliente. Reemplaza `console.*`
 * directos en componentes/hooks/lib (CLAUDE.md §1 prohíbe `console.*` en
 * código de producción).
 *
 * Forwardea a `console` con prefijo `[web]` (filtrable en DevTools) y, en
 * nivel `error`, reporta además al sink Sentry decidido en ADR-074
 * (docs/adr/074-sink-errores-client-side-sentry-scrubbing.md) vía
 * `error-reporting.ts` — único punto de envío, con scrubbing allowlist.
 * Sin DSN configurado el reporte es no-op y queda solo la consola.
 */

type LogContext = Record<string, unknown>;

type ErrorSink = (error: unknown) => void;

/**
 * Sink de nivel `error`, cableado por `error-reporting.ts` en el init
 * (ADR-074). Hook invertido a propósito: un import estático acá crearía el
 * ciclo logger → error-reporting → env → logger (TDZ real si env falla la
 * validación durante la evaluación del módulo). Antes del init: null = solo
 * consola, que es exactamente el comportamiento sin DSN.
 */
let errorSink: ErrorSink | null = null;

export function setLoggerErrorSink(sink: ErrorSink): void {
  errorSink = sink;
}

interface WebLogger {
  error(msgOrCtx: string | LogContext, message?: string): void;
  warn(msgOrCtx: string | LogContext, message?: string): void;
  info(msgOrCtx: string | LogContext, message?: string): void;
}

function emit(level: 'error' | 'warn' | 'info', a: string | LogContext, b?: string): void {
  const message = typeof a === 'string' ? a : (b ?? '');
  const context = typeof a === 'string' ? undefined : a;
  const prefix = '[web]';
  if (context !== undefined) {
    // biome-ignore lint/suspicious/noConsole: punto único de logging del cliente (ADR-074)
    console[level](prefix, message, context);
  } else {
    // biome-ignore lint/suspicious/noConsole: punto único de logging del cliente (ADR-074)
    console[level](prefix, message);
  }
  if (level === 'error' && errorSink) {
    const causa = context?.err;
    errorSink(causa instanceof Error ? causa : new Error(message || 'logger.error sin mensaje'));
  }
}

export const logger: WebLogger = {
  error: (a, b) => emit('error', a, b),
  warn: (a, b) => emit('warn', a, b),
  info: (a, b) => emit('info', a, b),
};
