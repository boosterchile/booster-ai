import { ProgressBar } from '@tremor/react';
import { useObservabilityForecast } from '../../hooks/use-observability.js';
import { CurrencyValue } from './CurrencyValue.js';
import { KpiCard } from './KpiCard.js';

/**
 * Tab Forecast — extrapolación lineal del gasto del mes en curso vs
 * budget mensual configurable. FX dinámico desde mindicador.cl.
 */
export function ForecastTab() {
  const forecast = useObservabilityForecast();

  if (forecast.isLoading) {
    return <SkeletonRect height={400} />;
  }

  if (!forecast.data) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
        <div className="font-medium">No se pudo cargar el forecast</div>
        {forecast.error && <div className="mt-1 font-mono text-xs">{forecast.error.message}</div>}
        <button
          type="button"
          onClick={() => forecast.refetch()}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-xs hover:bg-amber-100"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const d = forecast.data;
  const pctOfBudget =
    d.budgetClp > 0 ? Math.round((d.forecastClpEndOfMonth / d.budgetClp) * 100) : 0;
  const progressColor = pctOfBudget >= 100 ? 'red' : pctOfBudget >= 85 ? 'amber' : 'emerald';
  const isOver = d.variancePercent > 0;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-semibold text-lg text-neutral-900">Proyección fin de mes</h2>
        <p className="mt-1 text-neutral-500 text-xs">
          Día {d.dayOfMonth} de {d.daysInMonth} ({d.daysRemaining} restantes). Extrapolación lineal
          de lo gastado a la fecha. FX: {d.currentRate.clpPerUsd} CLP/USD ({d.currentRate.source}).
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <KpiCard
          label="Forecast fin de mes"
          value={<CurrencyValue amountClp={d.forecastClpEndOfMonth} size="xl" />}
          description={`${pctOfBudget}% del budget mensual`}
          status={isOver ? (pctOfBudget >= 110 ? 'critical' : 'degraded') : 'healthy'}
        />
        <KpiCard
          label="Budget mensual"
          value={<CurrencyValue amountClp={d.budgetClp} size="xl" />}
          description="MONTHLY_BUDGET_USD × FX actual"
          status="neutral"
        />
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="font-medium text-neutral-900 text-sm">Avance vs budget</h3>
          <span
            className={`font-medium text-xs ${isOver ? 'text-danger-700' : 'text-success-700'}`}
          >
            {isOver ? '↑' : '↓'} {Math.abs(d.variancePercent).toFixed(1)}%{' '}
            {isOver ? 'sobre' : 'bajo'} budget
          </span>
        </div>
        <ProgressBar value={Math.min(100, pctOfBudget)} color={progressColor} />
        <div className="mt-2 flex justify-between text-neutral-500 text-xs">
          <span>$0 CLP</span>
          <span>{pctOfBudget}%</span>
          <span>${d.budgetClp.toLocaleString('es-CL')} CLP</span>
        </div>
      </section>

      <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm">
        <h3 className="font-medium text-neutral-900">Información de tipo de cambio</h3>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-neutral-500">Fuente</dt>
            <dd className="font-medium text-neutral-900">{d.currentRate.source}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">CLP por USD</dt>
            <dd className="font-medium tabular-nums">${d.currentRate.clpPerUsd.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Observado</dt>
            <dd className="font-medium">
              {new Date(d.currentRate.observedAt).toLocaleDateString('es-CL')}
            </dd>
          </div>
        </dl>
        {d.currentRate.source !== 'mindicador' && (
          <div className="mt-2 text-amber-800 text-xs">
            ⚠️ FX no es del día actual. Si mindicador.cl está caído, el valor puede ser de hasta 24h
            o el fallback hardcoded 940. El forecast se ajustará cuando se restablezca.
          </div>
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
      aria-label="Cargando forecast"
    />
  );
}
