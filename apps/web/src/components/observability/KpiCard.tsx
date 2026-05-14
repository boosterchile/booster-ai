import type { ReactNode } from 'react';

/**
 * Tarjeta KPI compacta para el Observability Dashboard.
 *
 * Layout simple sin tremor (para evitar conflictos CSS con el design
 * system de Booster). Tremor lo reservamos para charts (LineChart,
 * BarChart) donde sí aporta valor real.
 */
export function KpiCard({
  label,
  value,
  description,
  status,
  icon,
}: {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  /** Color del borde left + dot — semáforo de salud. */
  status?: 'healthy' | 'degraded' | 'critical' | 'unknown' | 'neutral';
  icon?: ReactNode;
}) {
  const borderClass = {
    healthy: 'border-l-success-500',
    degraded: 'border-l-amber-500',
    critical: 'border-l-danger-500',
    unknown: 'border-l-neutral-300',
    neutral: 'border-l-primary-500',
  }[status ?? 'neutral'];

  return (
    <section
      className={`rounded-lg border border-neutral-200 border-l-4 bg-white p-4 shadow-sm ${borderClass}`}
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="font-medium text-neutral-600 text-xs uppercase tracking-wide">
          {label}
        </span>
        {icon && <span className="text-neutral-400">{icon}</span>}
      </header>
      <div className="mt-2">{value}</div>
      {description && <div className="mt-2 text-neutral-500 text-xs">{description}</div>}
    </section>
  );
}
