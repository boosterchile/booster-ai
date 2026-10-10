import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { describe, expect, it, vi } from 'vitest';
import { BusinessOnlyMetricExporter } from './business-metric-exporter.js';

function rm(...scopes: string[]): ResourceMetrics {
  return {
    resource: resourceFromAttributes({}),
    scopeMetrics: scopes.map((name) => ({ scope: { name }, metrics: [] })),
  };
}

describe('BusinessOnlyMetricExporter', () => {
  it('deja pasar solo los scopes */business', async () => {
    const inner = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const exporter = new BusinessOnlyMetricExporter(inner);
    await new Promise<void>((resolve) =>
      exporter.export(rm('booster-ai-api/business', '@opentelemetry/instrumentation-http'), () =>
        resolve(),
      ),
    );
    expect(inner.getMetrics().flatMap((r) => r.scopeMetrics.map((s) => s.scope.name))).toEqual([
      'booster-ai-api/business',
    ]);
  });

  it('sin scopes de negocio no llama al exporter interno y reporta éxito', async () => {
    const inner = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const spy = vi.spyOn(inner, 'export');
    const result = await new Promise<{ code: number }>((resolve) =>
      new BusinessOnlyMetricExporter(inner).export(
        rm('@opentelemetry/instrumentation-pg'),
        resolve,
      ),
    );
    expect(result.code).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('acepta un predicado propio y delega forceFlush/shutdown', async () => {
    const inner = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const flush = vi.spyOn(inner, 'forceFlush');
    const shutdown = vi.spyOn(inner, 'shutdown');
    const exporter = new BusinessOnlyMetricExporter(inner, (n) => n === 'x');
    await new Promise<void>((resolve) => exporter.export(rm('x', 'y'), () => resolve()));
    expect(inner.getMetrics()[0]?.scopeMetrics.map((s) => s.scope.name)).toEqual(['x']);
    await exporter.forceFlush();
    await exporter.shutdown();
    expect(flush).toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
