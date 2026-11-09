import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { instruccionesRetiroQueryOptions } from '../../lib/instrucciones-retiro-api.js';

/**
 * Instrucciones de retiro en la pantalla del conductor, mientras el viaje está
 * por recoger: el lugar, la nota y el QR para mostrar en el punto de retiro.
 * Si el generador no cargó nada, no se muestra.
 */
export function InstruccionesRetiroConductor({ tripId }: { tripId: string }) {
  const consulta = useQuery(instruccionesRetiroQueryOptions(tripId));

  if (consulta.isError) {
    return (
      <div role="alert" className="space-y-2 text-danger-700 text-sm">
        <p>No pudimos cargar las instrucciones de retiro.</p>
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 text-xs"
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (!consulta.isSuccess || !consulta.data) {
    return null;
  }
  const { lugar, nota, archivo, archivo_vencido: archivoVencido } = consulta.data;
  return (
    <section
      aria-label="Instrucciones de retiro"
      className="space-y-2 rounded-md border border-primary-200 bg-primary-50 p-3"
    >
      <p className="font-semibold text-primary-900 text-sm">Instrucciones de retiro</p>
      {lugar && (
        <p className="flex gap-1.5 text-neutral-900 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" aria-hidden />
          {lugar}
        </p>
      )}
      {nota && <p className="text-neutral-800 text-sm">{nota}</p>}
      {archivo && archivo.mime !== 'application/pdf' && (
        <img
          src={archivo.url}
          alt="QR o comprobante para mostrar en el lugar de retiro"
          className="mx-auto w-full max-w-xs rounded-md border border-neutral-200 bg-white"
        />
      )}
      {archivoVencido && (
        <p className="text-neutral-700 text-sm">
          El QR o comprobante ya no está disponible. Pídele al generador que lo vuelva a cargar.
        </p>
      )}
      {archivo && archivo.mime === 'application/pdf' && (
        <a
          href={archivo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-800 text-xs"
        >
          Ver comprobante de retiro
        </a>
      )}
    </section>
  );
}
