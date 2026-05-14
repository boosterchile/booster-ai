import { useObservabilityHealth } from '../../hooks/use-observability.js';
import { HealthIndicator } from './HealthIndicator.js';
import { KpiCard } from './KpiCard.js';

/**
 * Tab Salud — composite health snapshot del backend.
 * Renderiza el overall + un HealthIndicator por componente.
 */
export function SaludTab() {
  const health = useObservabilityHealth();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-semibold text-lg text-neutral-900">Salud técnica</h2>
        <p className="mt-1 text-neutral-500 text-xs">
          Uptime checks + Cloud Run + Cloud SQL. Cache 60s.
        </p>
      </header>

      <KpiCard
        label="Estado general"
        value={
          health.isLoading ? (
            <span className="text-neutral-400 text-sm">Cargando…</span>
          ) : health.data ? (
            <OverallBadge level={health.data.overall} />
          ) : (
            <span className="text-neutral-400 text-sm">—</span>
          )
        }
        description={
          health.data
            ? `Última evaluación: ${new Date(health.data.lastEvaluatedAt).toLocaleString('es-CL')}`
            : null
        }
        status={health.data?.overall ?? 'neutral'}
      />

      <section>
        <h3 className="mb-2 font-medium text-neutral-900 text-sm">Componentes</h3>
        {health.isLoading ? (
          <SkeletonStack count={3} />
        ) : health.data ? (
          <div className="space-y-2">
            {health.data.components.map((c) => (
              <HealthIndicator key={c.name} level={c.level} label={c.name} message={c.message} />
            ))}
          </div>
        ) : (
          <ErrorBox error={health.error} retry={health.refetch} />
        )}
      </section>
    </div>
  );
}

function OverallBadge({ level }: { level: 'healthy' | 'degraded' | 'critical' | 'unknown' }) {
  const text = {
    healthy: '🟢 Healthy',
    degraded: '🟡 Degraded',
    critical: '🔴 Critical',
    unknown: '⚪ Unknown',
  }[level];
  return <span className="font-semibold text-2xl">{text}</span>;
}

function SkeletonStack({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
        <div key={i} className="h-12 animate-pulse rounded-md bg-neutral-100" />
      ))}
    </div>
  );
}

function ErrorBox({ error, retry }: { error: Error | null; retry: () => void }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
      <div className="font-medium">No se pudo cargar el health snapshot</div>
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
