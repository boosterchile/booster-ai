/**
 * Logger del frontend web (PWA).
 *
 * Punto único de control para logging del cliente. Reemplaza `console.*`
 * directos en componentes/hooks/lib (CLAUDE.md §1 prohíbe `console.*` en
 * código de producción).
 *
 * Estado actual: forwardea a `console` con prefijo `[web]` para que sea
 * filtrable en DevTools del usuario y capturable por `window.onerror` /
 * `window.addEventListener('unhandledrejection')` futuras.
 *
 * TODO(adr-pendiente): definir sink de browser observability — Sentry vs
 * OpenTelemetry browser SDK vs envío a backend `/api/log/client`. Una vez
 * decidido, esta es la única superficie a cambiar.
 */

type LogContext = Record<string, unknown>;

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
    // biome-ignore lint/suspicious/noConsole: punto único de logging del cliente; ver TODO de ADR pendiente arriba
    console[level](prefix, message, context);
  } else {
    // biome-ignore lint/suspicious/noConsole: punto único de logging del cliente; ver TODO de ADR pendiente arriba
    console[level](prefix, message);
  }
}

export const logger: WebLogger = {
  error: (a, b) => emit('error', a, b),
  warn: (a, b) => emit('warn', a, b),
  info: (a, b) => emit('info', a, b),
};
