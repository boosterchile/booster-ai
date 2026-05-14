/**
 * Indicador visual healthy/degraded/critical/unknown — dot coloreado +
 * label.
 *
 * Uso típico:
 *   <HealthIndicator level="healthy" label="Uptime" message="99.9% en últimos 60 min" />
 */
export function HealthIndicator({
  level,
  label,
  message,
}: {
  level: 'healthy' | 'degraded' | 'critical' | 'unknown';
  label: string;
  message?: string;
}) {
  const dotColor = {
    healthy: 'bg-success-500',
    degraded: 'bg-amber-500',
    critical: 'bg-danger-500',
    unknown: 'bg-neutral-300',
  }[level];

  const labelColor = {
    healthy: 'text-success-700',
    degraded: 'text-amber-700',
    critical: 'text-danger-700',
    unknown: 'text-neutral-600',
  }[level];

  const ariaLabel = `${label}: ${level}${message ? ` — ${message}` : ''}`;

  return (
    <output
      className="flex items-center gap-3 rounded-md bg-neutral-50 p-3"
      aria-label={ariaLabel}
      data-testid={`health-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${dotColor}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={`font-medium text-sm ${labelColor}`}>{label}</div>
        {message && <div className="mt-0.5 text-neutral-600 text-xs">{message}</div>}
      </div>
    </output>
  );
}
