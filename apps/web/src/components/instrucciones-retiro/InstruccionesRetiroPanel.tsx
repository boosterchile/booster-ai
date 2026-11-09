import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, QrCode } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import {
  type InstruccionesRetiro,
  esArchivoPermitido,
  guardarInstruccionesRetiro,
  instruccionesRetiroQueryOptions,
  mensajeErrorInstrucciones,
} from '../../lib/instrucciones-retiro-api.js';

/**
 * Instrucciones de retiro en el detalle de la carga del generador: el QR o
 * comprobante que le entregó el lugar de retiro, con el lugar y una nota para
 * el conductor. Quien no puede publicar cargas las ve, pero no las edita.
 */
export function InstruccionesRetiroPanel({
  tripId,
  canWrite,
}: {
  tripId: string;
  canWrite: boolean;
}) {
  const consulta = useQuery(instruccionesRetiroQueryOptions(tripId));
  const [editando, setEditando] = useState(false);

  return (
    <section
      aria-labelledby={`retiro-${tripId}`}
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`retiro-${tripId}`} className="font-semibold text-neutral-900 text-sm">
            Instrucciones de retiro
          </h3>
          <p className="mt-0.5 text-neutral-600 text-xs">
            El QR o comprobante del lugar de retiro. El conductor lo verá en su pantalla.
          </p>
        </div>
        {canWrite && !editando && consulta.isSuccess && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 text-xs"
          >
            {consulta.data ? 'Reemplazar' : 'Cargar'}
          </button>
        )}
      </div>

      {consulta.isPending && <p className="mt-3 text-neutral-600 text-sm">Cargando…</p>}
      {consulta.isError && (
        <div role="alert" className="mt-3 space-y-2 text-danger-700 text-sm">
          <p>No pudimos cargar las instrucciones de retiro.</p>
          <button
            type="button"
            onClick={() => void consulta.refetch()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 text-xs"
          >
            Reintentar
          </button>
        </div>
      )}
      {consulta.isSuccess && !editando && (
        <Resumen instrucciones={consulta.data} canWrite={canWrite} />
      )}
      {consulta.isSuccess && editando && (
        <Formulario
          tripId={tripId}
          actual={consulta.data}
          onListo={() => setEditando(false)}
          onCancelar={() => setEditando(false)}
        />
      )}
    </section>
  );
}

function Resumen({
  instrucciones,
  canWrite,
}: {
  instrucciones: InstruccionesRetiro | null;
  canWrite: boolean;
}) {
  if (!instrucciones) {
    return (
      <p className="mt-3 text-neutral-600 text-sm">
        {canWrite
          ? 'Sin instrucciones. Si el retiro es en otro lugar o te entregaron un QR, cárgalo aquí.'
          : 'Sin instrucciones de retiro.'}
      </p>
    );
  }
  return (
    <dl className="mt-3 space-y-2 text-sm">
      {instrucciones.lugar && (
        <div>
          <dt className="sr-only">Lugar de retiro</dt>
          <dd className="flex gap-2 text-neutral-900">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
            {instrucciones.lugar}
          </dd>
        </div>
      )}
      {instrucciones.nota && (
        <div>
          <dt className="sr-only">Nota para el conductor</dt>
          <dd className="text-neutral-700">{instrucciones.nota}</dd>
        </div>
      )}
      {(instrucciones.archivo || instrucciones.archivo_vencido) && (
        <div>
          <dt className="sr-only">QR o comprobante</dt>
          <dd className="flex gap-2">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
            {instrucciones.archivo ? (
              <a
                href={instrucciones.archivo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary-700 underline"
              >
                Ver QR o comprobante
              </a>
            ) : (
              <span className="text-neutral-700">
                El archivo ya no está disponible (se guarda 90 días). Vuelve a subirlo si el retiro
                sigue pendiente.
              </span>
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}

function Formulario({
  tripId,
  actual,
  onListo,
  onCancelar,
}: {
  tripId: string;
  actual: InstruccionesRetiro | null;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [lugar, setLugar] = useState(actual?.lugar ?? '');
  const [nota, setNota] = useState(actual?.nota ?? '');
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () => guardarInstruccionesRetiro(tripId, { file, lugar, nota }),
    onSuccess: (data) => {
      queryClient.setQueryData(instruccionesRetiroQueryOptions(tripId).queryKey, data);
      onListo();
    },
    onError: (err) => setError(mensajeErrorInstrucciones(err)),
  });

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (file) {
      const check = esArchivoPermitido(file);
      if (!check.ok) {
        setError(check.mensaje);
        return;
      }
    }
    if (!file && !actual?.archivo && nota.trim().length === 0) {
      setError('Agrega el QR o comprobante, o una nota para el conductor.');
      return;
    }
    guardar.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
      <label className="block text-sm">
        <span className="font-medium text-neutral-800">QR o comprobante (PNG, JPEG o PDF)</span>
        <input
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
        {actual?.archivo && !file && (
          <span className="mt-1 block text-neutral-500 text-xs">
            Si no eliges otro, se mantiene el actual.
          </span>
        )}
      </label>
      <label className="block text-sm">
        <span className="font-medium text-neutral-800">Lugar de retiro</span>
        <input
          type="text"
          value={lugar}
          maxLength={500}
          onChange={(ev) => setLugar(ev.target.value)}
          placeholder="Si no es el origen de la carga"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-neutral-800">Nota para el conductor</span>
        <textarea
          value={nota}
          maxLength={500}
          onChange={(ev) => setNota(ev.target.value)}
          placeholder="Contacto, horario, andén"
          rows={2}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-danger-700 text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={guardar.isPending}
          className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
