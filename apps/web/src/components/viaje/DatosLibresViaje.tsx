import { Phone } from 'lucide-react';

/**
 * Contacto del destinatario, notas y referencia de la carga, en solo lectura,
 * para la transportista y el conductor (spec editar-anular-cargas §12-P4). Los
 * edita el generador; si no hay ninguno de los tres, no se muestra.
 */
export interface DatosLibresViajeProps {
  consignee?: { name: string | null; phone_e164: string | null } | null;
  notes?: string | null;
  reference?: string | null;
  className?: string;
}

export function DatosLibresViaje({
  consignee,
  notes,
  reference,
  className,
}: DatosLibresViajeProps) {
  const nombre = consignee?.name ?? null;
  const telefono = consignee?.phone_e164 ?? null;
  if (!nombre && !telefono && !notes && !reference) {
    return null;
  }
  return (
    <section
      aria-label="Contacto y notas del generador"
      className={`space-y-2 rounded-md border border-neutral-200 bg-white p-3 text-sm ${className ?? ''}`}
    >
      <p className="font-semibold text-neutral-900">Contacto y notas</p>
      {(nombre || telefono) && (
        <p className="flex flex-wrap items-center gap-2 text-neutral-900">
          <span>Recibe: {nombre ?? 'Sin nombre'}</span>
          {telefono && (
            <a
              href={`tel:${telefono}`}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 font-medium text-neutral-800 text-xs"
            >
              <Phone className="h-3 w-3" aria-hidden />
              Llamar {telefono}
            </a>
          )}
        </p>
      )}
      {notes && <p className="whitespace-pre-line text-neutral-800">{notes}</p>}
      {reference && <p className="text-neutral-600 text-xs">Referencia: {reference}</p>}
    </section>
  );
}
