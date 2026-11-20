import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import {
  DOC_TYPE_LABEL,
  listTransportDocuments,
  openTransportDocumentDownload,
} from '../../lib/transport-documents-api.js';

/**
 * documentos-conductor: los documentos del viaje en la pantalla del conductor,
 * para acreditar origen y destino de la carga en una fiscalización. Solo
 * lectura: los suben el generador o la oficina. El API autoriza al conductor
 * solo sobre su propia asignación.
 */
export function DocumentosViajeConductor({ tripId }: { tripId: string }) {
  const lista = useQuery({
    queryKey: ['conductor', 'documentos-viaje', tripId],
    queryFn: () => listTransportDocuments(tripId),
  });
  const [errorAbrir, setErrorAbrir] = useState(false);

  async function ver(documentId: string) {
    setErrorAbrir(false);
    try {
      await openTransportDocumentDownload(documentId);
    } catch {
      setErrorAbrir(true);
    }
  }

  if (lista.isPending) {
    return <p className="text-neutral-600 text-sm">Cargando documentos…</p>;
  }

  if (lista.isError) {
    return (
      <div role="alert" className="space-y-2 text-danger-700 text-sm">
        <p>No pudimos cargar los documentos del viaje.</p>
        <button
          type="button"
          onClick={() => void lista.refetch()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 text-xs"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (lista.data.length === 0) {
    return (
      <p className="text-neutral-600 text-sm">
        Tu oficina o el generador todavía no carga la guía ni la factura de este viaje.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
        {lista.data.map((d) => {
          const tipo = DOC_TYPE_LABEL[d.docType];
          return (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 text-sm">{tipo}</p>
                  {d.folio ? <p className="text-neutral-600 text-xs">Folio {d.folio}</p> : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void ver(d.id)}
                aria-label={`Ver ${tipo}`}
                className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 text-xs"
              >
                Ver
              </button>
            </li>
          );
        })}
      </ul>
      {errorAbrir ? (
        <p role="alert" className="text-danger-700 text-sm">
          El documento no se pudo abrir. Inténtalo de nuevo en un momento.
        </p>
      ) : null}
    </div>
  );
}
