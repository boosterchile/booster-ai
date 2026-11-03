import { Info } from 'lucide-react';

/** Resultado del alta cuando el RUT ya existe en Booster. Igual para cualquier persona. */
export function SolicitudRegistrada({
  volverLabel,
  onVolver,
}: {
  volverLabel: string;
  onVolver: () => void;
}) {
  return (
    <div
      data-testid="solicitud-registrada"
      className="mt-6 rounded-lg border border-neutral-300 bg-neutral-50 p-4"
    >
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-neutral-600" aria-hidden />
        <div>
          <div className="font-semibold text-neutral-900">Solicitud registrada</div>
          <p className="mt-1 text-neutral-700 text-sm">
            Se sumará a tu equipo cuando acepte. Pronto podrá hacerlo desde Booster; por ahora,
            avísale tú.
          </p>
          <button
            type="button"
            onClick={onVolver}
            className="mt-3 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
          >
            {volverLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
