import { type Attributes, type Counter, metrics } from '@opentelemetry/api';

/**
 * Helper para métricas de NEGOCIO (contadores), hermano de `business-span.ts`
 * (`withBusinessSpan`/`BUSINESS_SPAN_TRACER`). Primer uso real: contador
 * `dispositivo_asociaciones_total` en `PATCH /vehiculos/:id/dispositivo`
 * (fix TOCTOU, W2 self-service) — hasta esa fecha ningún endpoint del API
 * emitía métricas de negocio (deuda preexistente, ver
 * `.specs/_followups/vehiculos-router-otel-spans.md`).
 *
 * Igual que `business-span.ts`: en dev/test no hay `MeterProvider` registrado
 * → `metrics.getMeter` devuelve el meter no-op del SDK y `counter.add(...)`
 * es un no-op seguro (no rompe tests).
 */
export const BUSINESS_METER_NAME = 'booster-ai-api/business';

const meter = metrics.getMeter(BUSINESS_METER_NAME);

/** Cache de instrumentos por nombre — un Counter debe crearse una sola vez por proceso, no por request. */
const counterCache = new Map<string, Counter>();

/**
 * Obtiene (memoizado) un Counter de negocio por nombre. Los labels van en
 * `attributes` de `.add()`, no acá — así el mismo Counter sirve para todos
 * los resultados/dimensiones de una misma operación de negocio.
 */
export function getBusinessCounter(name: string): Counter {
  let counter = counterCache.get(name);
  if (!counter) {
    counter = meter.createCounter(name);
    counterCache.set(name, counter);
  }
  return counter;
}

export type BusinessCounterAttributes = Attributes;
