import { LineChart } from '@tremor/react';

/**
 * Line chart de serie temporal usando @tremor/react. Wrapper que normaliza
 * la API a la shape que devuelve `/admin/observability/costs/trend`:
 *   [{ date: '2026-05-13', costClp: 5000 }, ...]
 *
 * Formato eje Y: CLP con separadores de miles. Eje X: fecha en es-CL
 * (corto: "13 may", "14 may").
 */
export function TrendChart({
  points,
  categoryLabel = 'Costo CLP',
  height = 280,
}: {
  points: Array<{ date: string; costClp: number }>;
  categoryLabel?: string;
  height?: number;
}) {
  const data = points.map((p) => ({
    date: formatShortDate(p.date),
    [categoryLabel]: p.costClp,
  }));

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-500 text-sm"
        style={{ height }}
      >
        Sin datos en el rango seleccionado.
      </div>
    );
  }

  // NOTA: Tremor LineChart consume `className` para su wrapper interno; si
  // pasamos `h-[280px]` como template string, Tailwind 4 no detecta la clase
  // arbitrary y el wrapper queda con height: 0 (chart invisible). Usamos
  // `h-full` (clase estándar siempre emitida) y forzamos la altura del
  // parent vía style inline.
  return (
    <div style={{ height, width: '100%' }}>
      <LineChart
        className="h-full w-full"
        data={data}
        index="date"
        categories={[categoryLabel]}
        colors={['emerald']}
        valueFormatter={(v) => `$${Math.round(v).toLocaleString('es-CL')}`}
        showLegend={false}
        yAxisWidth={75}
      />
    </div>
  );
}

function formatShortDate(iso: string): string {
  // iso = "2026-05-13"; parse local sin timezone shift
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) {
    return iso;
  }
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}
