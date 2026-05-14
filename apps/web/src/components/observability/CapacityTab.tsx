import { ProgressBar } from '@tremor/react';
import {
  useObservabilityCloudRun,
  useObservabilityCloudSql,
} from '../../hooks/use-observability.js';
import { KpiCard } from './KpiCard.js';

/**
 * Tab Capacity — headroom CPU/RAM/disco/conexiones de Cloud Run + Cloud SQL.
 * Usa @tremor/react ProgressBar para mostrar % de uso con color semáforo.
 */
export function CapacityTab() {
  const cloudRun = useObservabilityCloudRun();
  const cloudSql = useObservabilityCloudSql();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Cloud Run</h2>
        <p className="mt-1 mb-3 text-neutral-500 text-xs">
          Media de utilización en últimos 15 min. Cache 60s.
        </p>
        {cloudRun.isLoading ? (
          <SkeletonGrid count={4} />
        ) : cloudRun.data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="CPU"
              value={
                <UtilizationBar
                  value={cloudRun.data.cpuUtilization}
                  thresholds={{ warning: 0.7, critical: 0.85 }}
                />
              }
              status={resourceLevel(cloudRun.data.cpuUtilization, 0.7, 0.85)}
            />
            <KpiCard
              label="RAM"
              value={
                <UtilizationBar
                  value={cloudRun.data.ramUtilization}
                  thresholds={{ warning: 0.8, critical: 0.92 }}
                />
              }
              status={resourceLevel(cloudRun.data.ramUtilization, 0.8, 0.92)}
            />
            <KpiCard
              label="Latencia p95"
              value={
                <span className="font-bold text-3xl">
                  {cloudRun.data.latencyP95Ms !== null
                    ? `${Math.round(cloudRun.data.latencyP95Ms)} ms`
                    : '—'}
                </span>
              }
              description="Cloud Run request_latencies (avg)"
              status="neutral"
            />
            <KpiCard
              label="Throughput"
              value={
                <span className="font-bold text-3xl">
                  {cloudRun.data.rps !== null ? `${cloudRun.data.rps.toFixed(1)} rps` : '—'}
                </span>
              }
              description="request_count rate"
              status="neutral"
            />
          </div>
        ) : (
          <ErrorBox error={cloudRun.error} retry={cloudRun.refetch} />
        )}
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Cloud SQL Postgres</h2>
        <p className="mt-1 mb-3 text-neutral-500 text-xs">
          Headroom de recursos de la instancia. Si CPU/RAM/disk se acercan al límite, es momento de
          right-size.
        </p>
        {cloudSql.isLoading ? (
          <SkeletonGrid count={4} />
        ) : cloudSql.data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="CPU"
              value={
                <UtilizationBar
                  value={cloudSql.data.cpuUtilization}
                  thresholds={{ warning: 0.7, critical: 0.85 }}
                />
              }
              status={resourceLevel(cloudSql.data.cpuUtilization, 0.7, 0.85)}
            />
            <KpiCard
              label="RAM"
              value={
                <UtilizationBar
                  value={cloudSql.data.ramUtilization}
                  thresholds={{ warning: 0.8, critical: 0.92 }}
                />
              }
              status={resourceLevel(cloudSql.data.ramUtilization, 0.8, 0.92)}
            />
            <KpiCard
              label="Disco"
              value={
                <UtilizationBar
                  value={cloudSql.data.diskUtilization}
                  thresholds={{ warning: 0.75, critical: 0.9 }}
                />
              }
              status={resourceLevel(cloudSql.data.diskUtilization, 0.75, 0.9)}
            />
            <KpiCard
              label="Conexiones"
              value={
                <UtilizationBar
                  value={cloudSql.data.connectionsUsedRatio}
                  thresholds={{ warning: 0.7, critical: 0.9 }}
                />
              }
              status={resourceLevel(cloudSql.data.connectionsUsedRatio, 0.7, 0.9)}
            />
          </div>
        ) : (
          <ErrorBox error={cloudSql.error} retry={cloudSql.refetch} />
        )}
      </section>
    </div>
  );
}

function UtilizationBar({
  value,
  thresholds,
}: {
  value: number | null;
  thresholds: { warning: number; critical: number };
}) {
  if (value === null) {
    return <span className="text-neutral-400 text-sm">Sin datos</span>;
  }
  const percent = Math.round(value * 100);
  const color =
    value >= thresholds.critical ? 'red' : value >= thresholds.warning ? 'amber' : 'emerald';
  return (
    <div className="space-y-2">
      <div className="font-bold text-3xl text-neutral-900 tabular-nums">{percent}%</div>
      <ProgressBar value={percent} color={color} />
    </div>
  );
}

function resourceLevel(
  value: number | null,
  warning: number,
  critical: number,
): 'healthy' | 'degraded' | 'critical' | 'unknown' {
  if (value === null) {
    return 'unknown';
  }
  if (value >= critical) {
    return 'critical';
  }
  if (value >= warning) {
    return 'degraded';
  }
  return 'healthy';
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
        <div key={i} className="h-24 animate-pulse rounded-md bg-neutral-100" />
      ))}
    </div>
  );
}

function ErrorBox({ error, retry }: { error: Error | null; retry: () => void }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
      <div className="font-medium">No se pudo cargar la utilización</div>
      {error && <div className="mt-1 font-mono text-xs">{error.message}</div>}
      <button
        type="button"
        onClick={() => retry()}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-xs hover:bg-amber-100"
      >
        Reintentar
      </button>
    </div>
  );
}
