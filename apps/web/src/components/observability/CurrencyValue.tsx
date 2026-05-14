/**
 * Renderiza un monto CLP con separadores de miles (es-CL) y delta% opcional
 * coloreado (verde si baja, rojo si sube — porque en gasto la dirección
 * óptima es bajar).
 */
export function CurrencyValue({
  amountClp,
  deltaPercent,
  prefix = '$',
  suffix = ' CLP',
  size = 'lg',
}: {
  amountClp: number;
  deltaPercent?: number | null;
  prefix?: string;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const sizeClass = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl font-semibold',
    xl: 'text-4xl font-bold',
  }[size];

  const formatted = `${prefix}${Math.round(amountClp).toLocaleString('es-CL')}${suffix}`;

  return (
    <div className="inline-flex items-baseline gap-2">
      <span className={`${sizeClass} text-neutral-900 tabular-nums`}>{formatted}</span>
      {deltaPercent !== null && deltaPercent !== undefined && <DeltaBadge percent={deltaPercent} />}
    </div>
  );
}

function DeltaBadge({ percent }: { percent: number }) {
  // En gasto: subir es malo (rojo), bajar es bueno (verde).
  const isIncrease = percent > 0;
  const color = isIncrease ? 'bg-danger-50 text-danger-700' : 'bg-success-50 text-success-700';
  const arrow = isIncrease ? '↑' : percent < 0 ? '↓' : '·';
  const value = `${Math.abs(percent).toFixed(1)}%`;

  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs ${color}`}>
      <span aria-hidden>{arrow}</span>
      {value}
    </span>
  );
}
