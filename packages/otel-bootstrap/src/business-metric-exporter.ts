import type { ExportResult } from '@opentelemetry/core';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';

/** Sufijo de los meters de negocio: `<servicio>/business` (business-metrics.ts del api). */
export const BUSINESS_METER_SUFFIX = '/business';

/**
 * Exporta solo los scopes de métricas de negocio. La auto-instrumentación
 * (HTTP, pg, grpc…) también registra histogramas por ruta; enviarlos a
 * Cloud Monitoring costaría del orden de GiB/mes en distribuciones y
 * duplicaría lo que Cloud Run ya mide (request_count, request_latencies).
 * T10-15 pide métricas de negocio, no de transporte.
 */
export class BusinessOnlyMetricExporter implements PushMetricExporter {
  constructor(
    private readonly inner: PushMetricExporter,
    private readonly incluir: (scopeName: string) => boolean = (n) =>
      n.endsWith(BUSINESS_METER_SUFFIX),
  ) {}

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    const scopeMetrics = metrics.scopeMetrics.filter((sm) => this.incluir(sm.scope.name));
    if (scopeMetrics.length === 0) {
      resultCallback({ code: 0 });
      return;
    }
    this.inner.export({ ...metrics, scopeMetrics }, resultCallback);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
  // Sin selectAggregationTemporality: el SDK usa CUMULATIVE, que es lo que
  // espera el MetricExporter de Cloud Monitoring (tampoco lo define).
}
