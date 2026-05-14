import { BarChart, DonutChart } from '@tremor/react';
import {
  useObservabilityCostsByProject,
  useObservabilityCostsByService,
  useObservabilityCostsOverview,
  useObservabilityCostsTrend,
  useObservabilityTopSkus,
} from '../../hooks/use-observability.js';
import { CurrencyValue } from './CurrencyValue.js';
import { KpiCard } from './KpiCard.js';
import { TrendChart } from './TrendChart.js';

/**
 * Tab Costos — composite de:
 *   - KPI MTD + previous + delta%
 *   - Trend chart 30d
 *   - DonutChart by-service
 *   - BarChart by-project
 *   - Tabla top SKUs
 */
export function CostosTab() {
  const overview = useObservabilityCostsOverview();
  const byService = useObservabilityCostsByService(30);
  const byProject = useObservabilityCostsByProject(30);
  const trend = useObservabilityCostsTrend(30);
  const topSkus = useObservabilityTopSkus(10);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-semibold text-lg text-neutral-900">Costos del mes en curso</h2>
        <p className="mt-1 text-neutral-500 text-xs">
          Fuente: BigQuery billing_export (cache 5 min). Última actualización:{' '}
          {overview.data?.lastBillingExportAt
            ? new Date(overview.data.lastBillingExportAt).toLocaleString('es-CL')
            : '—'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label="Mes a la fecha"
          value={
            overview.isLoading ? (
              <span className="text-neutral-400 text-sm">Cargando…</span>
            ) : overview.data ? (
              <CurrencyValue
                amountClp={overview.data.costClpMonthToDate}
                deltaPercent={overview.data.deltaPercentVsPreviousMonth}
                size="xl"
              />
            ) : (
              <span className="text-neutral-400 text-sm">—</span>
            )
          }
          description={
            overview.data ? (
              <>
                <div>
                  vs mismo periodo mes anterior:{' '}
                  <strong>
                    ${overview.data.costClpPreviousMonthSamePeriod.toLocaleString('es-CL')} CLP
                  </strong>
                </div>
                <div className="mt-0.5 text-neutral-400">
                  Mes anterior completo: $
                  {overview.data.costClpPreviousMonth.toLocaleString('es-CL')} CLP
                </div>
              </>
            ) : null
          }
          status="neutral"
        />
        <KpiCard
          label="Tendencia 30d"
          value={
            <span className="text-2xl text-neutral-900">
              {trend.data ? `${trend.data.points.length} días` : '—'}
            </span>
          }
          description="Serie diaria del gasto consolidado (CLP)."
          status="neutral"
        />
        <KpiCard
          label="Top servicios"
          value={
            <span className="text-2xl text-neutral-900">
              {byService.data ? `${byService.data.items.length}` : '—'}
            </span>
          }
          description="Servicios GCP con gasto >0 en últimos 30d."
          status="neutral"
        />
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h3 className="font-medium text-neutral-900 text-sm">Gasto diario (últimos 30 días)</h3>
        <div className="mt-3">
          {trend.isLoading ? (
            <SkeletonRect height={280} />
          ) : trend.data ? (
            <TrendChart points={trend.data.points} height={280} />
          ) : (
            <ErrorBox error={trend.error} retry={trend.refetch} />
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h3 className="font-medium text-neutral-900 text-sm">Por servicio GCP</h3>
          <div className="mt-3">
            {byService.isLoading ? (
              <SkeletonRect height={260} />
            ) : byService.data && byService.data.items.length > 0 ? (
              <DonutChart
                className="h-60"
                data={byService.data.items.map((i) => ({ name: i.service, value: i.costClp }))}
                category="value"
                index="name"
                valueFormatter={(v) => `$${Math.round(v).toLocaleString('es-CL')}`}
                colors={['emerald', 'cyan', 'amber', 'indigo', 'rose', 'fuchsia']}
              />
            ) : (
              <ErrorBox error={byService.error} retry={byService.refetch} empty />
            )}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h3 className="font-medium text-neutral-900 text-sm">Por proyecto GCP</h3>
          <div className="mt-3">
            {byProject.isLoading ? (
              <SkeletonRect height={260} />
            ) : byProject.data && byProject.data.items.length > 0 ? (
              <BarChart
                className="h-60"
                data={byProject.data.items.map((i) => ({
                  project: i.projectName ?? i.projectId,
                  Costo: i.costClp,
                }))}
                index="project"
                categories={['Costo']}
                colors={['emerald']}
                valueFormatter={(v) => `$${Math.round(v).toLocaleString('es-CL')}`}
                yAxisWidth={75}
                showLegend={false}
              />
            ) : (
              <ErrorBox error={byProject.error} retry={byProject.refetch} empty />
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h3 className="font-medium text-neutral-900 text-sm">Top 10 SKUs del mes</h3>
        {topSkus.isLoading ? (
          <SkeletonRect height={200} />
        ) : topSkus.data && topSkus.data.items.length > 0 ? (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-neutral-100 border-b text-left text-neutral-500 text-xs">
                <th className="py-2 font-medium">Servicio</th>
                <th className="py-2 font-medium">SKU</th>
                <th className="py-2 text-right font-medium">Costo CLP</th>
              </tr>
            </thead>
            <tbody>
              {topSkus.data.items.map((s) => (
                <tr
                  key={`${s.service}-${s.sku}`}
                  className="border-neutral-50 border-b last:border-0"
                >
                  <td className="py-2 text-neutral-700">{s.service}</td>
                  <td className="py-2 text-neutral-600 text-xs">{s.sku}</td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    ${s.costClp.toLocaleString('es-CL')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ErrorBox error={topSkus.error} retry={topSkus.refetch} empty />
        )}
      </section>
    </div>
  );
}

function SkeletonRect({ height }: { height: number }) {
  return (
    <div
      className="animate-pulse rounded-md bg-neutral-100"
      style={{ height }}
      aria-label="Cargando"
    />
  );
}

function ErrorBox({
  error,
  retry,
  empty,
}: {
  error: Error | null;
  retry: () => void;
  empty?: boolean;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
      <div className="font-medium">{empty ? 'Sin datos disponibles' : 'No se pudo cargar'}</div>
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
