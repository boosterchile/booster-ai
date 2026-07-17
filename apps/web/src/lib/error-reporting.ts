import * as Sentry from '@sentry/react';
import type { BrowserOptions, ErrorEvent, EventHint } from '@sentry/react';
import { env } from './env.js';
import { setLoggerErrorSink } from './logger.js';

/**
 * Sink de errores client-side — implementación de ADR-074
 * (docs/adr/074-sink-errores-client-side-sentry-scrubbing.md).
 *
 * Dos piezas:
 *  - `scrubEvent`: proyección PURA por allowlist (default-deny). Es el
 *    contrato verificable del ADR y va cableada como `beforeSend`: ningún
 *    evento sale del browser sin pasar por acá.
 *  - `initErrorReporting` / `reportError`: sin DSN el init es no-op
 *    silencioso; el sink jamás rompe la app.
 *
 * Los 4 puntos de captura (router `defaultOnCatch`, listeners de window,
 * Query/MutationCache, `logger.error`) convergen en `reportError`.
 *
 * Ciclo de imports env.ts → logger.ts → error-reporting.ts → env.ts:
 * benigno porque acá `env` solo se lee DENTRO de funciones, nunca top-level.
 */

// ---------------------------------------------------------------------------
// Patrones de scrubbing — datos Booster protegidos (ADR-074 §política)
// ---------------------------------------------------------------------------

/**
 * Credenciales en strings: patrón reusado del RedactingSpanExporter del
 * backend (packages/otel-bootstrap/src/index.ts) para consistencia front/back.
 * Conserva el prefijo `param=` y redacta solo el valor.
 */
const CREDENCIAL = /((?:^|[?&\s])(?:auth|token|access_token|key|signature|code)=)[^&\s"']+/gi;

/** Orden deliberado: credencial primero (gana ante solapes), luego el resto. */
const PATRONES: ReadonlyArray<{ tipo: string; re: RegExp }> = [
  { tipo: 'rut', re: /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g },
  { tipo: 'imei', re: /\b\d{15}\b/g },
  { tipo: 'coordenadas', re: /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g },
  { tipo: 'monto', re: /(?:\$|\bCLP\s?)\s?\d{1,3}(?:\.\d{3})+(?:,\d+)?|\bUF\s?\d[\d.,]*/g },
  { tipo: 'email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { tipo: 'telefono', re: /\+?56\s?9\s?\d{4}\s?\d{4}/g },
  { tipo: 'patente', re: /\b[A-Z]{2}\s?[·-]?\s?[A-Z]{2}\s?[·-]?\s?\d{2}\b/g },
];

const MAX_MESSAGE_LENGTH = 300;

interface ScrubResult {
  text: string;
  hits: number;
}

function scrubText(input: string): ScrubResult {
  let hits = 0;
  let text = input.replace(CREDENCIAL, (_m, prefijo: string) => {
    hits += 1;
    return `${prefijo}[REDACTED-credencial]`;
  });
  for (const { tipo, re } of PATRONES) {
    text = text.replace(re, () => {
      hits += 1;
      return `[REDACTED-${tipo}]`;
    });
  }
  return { text, hits };
}

/** Pathname puro: sin origin, sin query, sin hash (allowlist ADR-074). */
function pathnameOnly(url: string): string {
  try {
    return new URL(url, 'https://app.invalid').pathname;
  } catch {
    // URL imposible de parsear: cortar en el primer ?/# es proyección segura.
    return url.split(/[?#]/)[0] ?? '';
  }
}

function pickNameVersion(
  ctx: Record<string, unknown> | undefined,
): { name?: string; version?: string } | undefined {
  if (!ctx) {
    return undefined;
  }
  const out: { name?: string; version?: string } = {};
  if (typeof ctx.name === 'string') {
    out.name = ctx.name;
  }
  if (typeof ctx.version === 'string') {
    out.version = ctx.version;
  }
  return out;
}

// ---------------------------------------------------------------------------
// scrubEvent — proyección por allowlist (el contrato de ADR-074)
// ---------------------------------------------------------------------------

/**
 * Reconstruye el evento con SOLO los campos de la allowlist de ADR-074.
 * No filtra sobre el evento original: PROYECTA — un campo nuevo del SDK
 * nace descartado hasta que un supersede del ADR lo permita.
 *
 * `platform` se emite como constante literal 'javascript': es un requisito
 * de enrutamiento/symbolication de Sentry, no proviene del evento y no
 * transporta datos (nota de implementación de la allowlist).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  let hits = 0;
  const scrub = (s: string | undefined): string | undefined => {
    if (s === undefined) {
      return undefined;
    }
    const r = scrubText(s);
    hits += r.hits;
    return r.text;
  };

  const values = (event.exception?.values ?? []).map((v) => {
    const value = scrub(v.value);
    // exactOptionalPropertyTypes: las claves ausentes se OMITEN, jamás se
    // acarrea `undefined` explícito.
    const frames = v.stacktrace?.frames?.map((f) => ({
      ...(f.filename !== undefined ? { filename: f.filename } : {}),
      ...(f.function !== undefined ? { function: f.function } : {}),
      ...(f.lineno !== undefined ? { lineno: f.lineno } : {}),
      ...(f.colno !== undefined ? { colno: f.colno } : {}),
    }));
    return {
      ...(v.type !== undefined ? { type: v.type } : {}),
      ...(value !== undefined ? { value: value.slice(0, MAX_MESSAGE_LENGTH) } : {}),
      ...(frames ? { stacktrace: { frames } } : {}),
    };
  });

  const browser = pickNameVersion(event.contexts?.browser as Record<string, unknown> | undefined);
  const os = pickNameVersion(event.contexts?.os as Record<string, unknown> | undefined);

  const out: ErrorEvent = {
    type: undefined,
    ...(event.event_id !== undefined ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.level !== undefined ? { level: event.level } : {}),
    ...(event.release !== undefined ? { release: event.release } : {}),
    ...(event.environment !== undefined ? { environment: event.environment } : {}),
    platform: 'javascript',
    ...(values.length > 0 ? { exception: { values } } : {}),
    ...(event.request?.url !== undefined
      ? { request: { url: pathnameOnly(event.request.url) } }
      : {}),
    ...(browser || os
      ? { contexts: { ...(browser ? { browser } : {}), ...(os ? { os } : {}) } }
      : {}),
  };

  if (hits > 0) {
    out.tags = { scrubbed: 'true' };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Init + captura
// ---------------------------------------------------------------------------

/**
 * Opciones del SDK según ADR-074: breadcrumbs e integraciones automáticas
 * apagadas EN ORIGEN (default-deny), PII off, tracing off, `scrubEvent`
 * como última barrera antes de cualquier envío.
 */
export function buildSentryOptions(dsn: string): BrowserOptions {
  return {
    dsn,
    release: env.VITE_RELEASE || undefined,
    environment: import.meta.env.MODE,
    defaultIntegrations: false,
    integrations: [],
    sendDefaultPii: false,
    sendClientReports: false,
    maxBreadcrumbs: 0,
    attachStacktrace: false,
    beforeBreadcrumb: () => null,
    beforeSend: (event: ErrorEvent, _hint: EventHint) => scrubEvent(event),
  };
}

/** Init idempotente. Sin `VITE_SENTRY_DSN` (dev/CI): no-op silencioso. */
export function initErrorReporting(): void {
  if (Sentry.getClient()) {
    return;
  }
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) {
    return;
  }
  try {
    Sentry.init(buildSentryOptions(dsn));
    // 4º punto de captura: logger.error → sink (hook invertido, ver logger.ts).
    setLoggerErrorSink(reportError);
  } catch (err) {
    // ADR-074: el sink jamás rompe la app. No se traga: queda visible en la
    // consola del browser (única vía sin ciclo de imports con logger.ts).
    // biome-ignore lint/suspicious/noConsole: fallback del propio sink de logging
    console.warn('[web] error-reporting: init falló, sink deshabilitado', err);
  }
}

/** Punto único de captura de los 4 wirings. Sin cliente activo: no-op. */
export function reportError(error: unknown): void {
  if (!Sentry.getClient()) {
    return;
  }
  try {
    Sentry.captureException(error);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: ver initErrorReporting — el sink jamás rompe la app
    console.warn('[web] error-reporting: captura falló', err);
  }
}
