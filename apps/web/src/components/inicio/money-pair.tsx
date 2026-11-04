import { RuleBadge } from './piezas.js';

export function MoneyPair({
  izquierda,
  derecha,
  regla,
}: {
  izquierda: { label: string; valor: string | null; detalle: string | null };
  derecha: { label: string; valor: string | null; detalle: string | null };
  regla: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Lado lado={izquierda} regla={regla} />
      <Lado lado={derecha} regla={regla} />
    </div>
  );
}

function Lado({
  lado,
  regla,
}: {
  lado: { label: string; valor: string | null; detalle: string | null };
  regla: boolean;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-neutral-500 text-xs">
        {lado.label}
        {regla && lado.valor == null ? <RuleBadge /> : null}
      </p>
      <p className="mt-1 font-semibold text-neutral-900 text-xl tabular-nums">
        {lado.valor ?? '—'}
      </p>
      {lado.detalle ? <p className="mt-0.5 text-neutral-600 text-xs">{lado.detalle}</p> : null}
    </div>
  );
}
