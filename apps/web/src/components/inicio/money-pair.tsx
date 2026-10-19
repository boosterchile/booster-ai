import { RuleBadge } from './piezas.js';

export interface LadoPlata {
  label: string;
  valor: string | null;
  detalle: string | null;
}

export function MoneyPair({
  izquierda,
  derecha,
  regla,
}: {
  izquierda: LadoPlata | null;
  derecha: LadoPlata | null;
  regla: boolean;
}) {
  const ambos = izquierda != null && derecha != null;
  return (
    <div className={ambos ? 'grid grid-cols-2 gap-3' : 'grid gap-3'}>
      {izquierda ? <Lado lado={izquierda} regla={regla} /> : null}
      {derecha ? <Lado lado={derecha} regla={regla} /> : null}
    </div>
  );
}

function Lado({ lado, regla }: { lado: LadoPlata; regla: boolean }) {
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
