import {
  type Attributes,
  type Counter,
  type Gauge,
  type Histogram,
  metrics,
} from '@opentelemetry/api';

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

/** Cache de instrumentos por nombre — un instrumento se crea una sola vez por proceso, no por request. */
const counterCache = new Map<string, Counter>();
const histogramCache = new Map<string, Histogram>();
const gaugeCache = new Map<string, Gauge>();

export interface BusinessHistogramOptions {
  description?: string;
  unit?: string;
}

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

/**
 * Obtiene (memoizado) un Histogram de negocio. La primera llamada fija
 * description/unit; las siguientes devuelven el mismo instrumento.
 */
export function getBusinessHistogram(name: string, options?: BusinessHistogramOptions): Histogram {
  let histogram = histogramCache.get(name);
  if (!histogram) {
    histogram = meter.createHistogram(name, {
      ...(options?.description ? { description: options.description } : {}),
      ...(options?.unit ? { unit: options.unit } : {}),
    });
    histogramCache.set(name, histogram);
  }
  return histogram;
}

/**
 * Obtiene (memoizado) un Gauge síncrono de negocio: el último valor
 * registrado es el que se exporta (p. ej. `caja.float_terceros_clp`,
 * ADR-080 §2). La primera llamada fija description/unit.
 */
export function getBusinessGauge(name: string, options?: BusinessHistogramOptions): Gauge {
  let gauge = gaugeCache.get(name);
  if (!gauge) {
    gauge = meter.createGauge(name, {
      ...(options?.description ? { description: options.description } : {}),
      ...(options?.unit ? { unit: options.unit } : {}),
    });
    gaugeCache.set(name, gauge);
  }
  return gauge;
}

export type BusinessCounterAttributes = Attributes;
