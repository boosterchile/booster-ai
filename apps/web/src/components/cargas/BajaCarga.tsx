import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Anular o cancelar una carga desde el detalle del generador
 * (spec editar-anular-cargas §9).
 *
 *   - `anular`: antes del match. Motivo opcional; la carga deja de aparecer
 *     en las listas y queda registrado quién y cuándo.
 *   - `cancelar`: con transportista asignado. Motivo obligatorio; la
 *     transportista y el conductor reciben un aviso en la app.
 */

export type ModoBaja = 'anular' | 'cancelar';

const MOTIVO_MAX = 500;

const TEXTOS: Record<
  ModoBaja,
  { boton: string; titulo: string; confirmar: string; enCurso: string; etiquetaMotivo: string }
> = {
  anular: {
    boton: 'Anular carga',
    titulo: '¿Anular esta carga?',
    confirmar: 'Sí, anular carga',
    enCurso: 'Anulando…',
    etiquetaMotivo: 'Motivo (opcional)',
  },
  cancelar: {
    boton: 'Cancelar servicio',
    titulo: '¿Cancelar este servicio?',
    confirmar: 'Sí, cancelar servicio',
    enCurso: 'Cancelando…',
    etiquetaMotivo: 'Motivo',
  },
};

export function mensajeErrorBaja(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'reason_required':
        return 'Escribe el motivo de la cancelación.';
      case 'trip_not_cancellable':
        return 'La carga cambió de estado y ya no se puede dar de baja. Recarga la página.';
      case 'read_only':
      case 'capability_denied':
        return 'Tu rol no puede anular ni cancelar cargas.';
    }
  }
  return 'No pudimos completar la acción. Inténtalo de nuevo.';
}

export function BajaCarga({
  tripId,
  modo,
  telefonoConductor,
}: {
  tripId: string;
  modo: ModoBaja;
  telefonoConductor?: string | null;
}) {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textos = TEXTOS[modo];

  const baja = useMutation({
    mutationFn: () => {
      const m = motivo.trim();
      return api.patch(`/trip-requests-v2/${tripId}/cancelar`, m ? { reason: m } : {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
      queryClient.invalidateQueries({ queryKey: ['cargas', tripId] });
      setAbierto(false);
      setMotivo('');
    },
    onError: (err) => setError(mensajeErrorBaja(err)),
  });

  function cerrar() {
    setAbierto(false);
    setMotivo('');
    setError(null);
  }

  function confirmar() {
    setError(null);
    if (modo === 'cancelar' && !motivo.trim()) {
      setError('Escribe el motivo de la cancelación.');
      return;
    }
    baja.mutate();
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex items-center gap-1 rounded-md border border-danger-300 px-3 py-1.5 text-danger-700 text-sm hover:bg-danger-50"
      >
        <Ban className="h-4 w-4" aria-hidden />
        {textos.boton}
      </button>
    );
  }

  return (
    <section
      aria-label={textos.titulo}
      className="rounded-lg border border-danger-200 bg-danger-50 p-4"
    >
      <h3 className="font-semibold text-danger-900 text-sm">{textos.titulo}</h3>
      <p className="mt-1 text-danger-800 text-sm">
        {modo === 'anular'
          ? 'La carga dejará de aparecer en tus listas. Queda registrado quién la anuló y cuándo.'
          : `Avisaremos al transportista y al conductor por la app.${
              telefonoConductor
                ? ` Si la recogida es pronto, llama al conductor: ${telefonoConductor}`
                : ''
            }`}
      </p>
      <label className="mt-3 block text-sm">
        <span className="font-medium text-danger-900">{textos.etiquetaMotivo}</span>
        <input
          type="text"
          value={motivo}
          onChange={(ev) => setMotivo(ev.target.value)}
          maxLength={MOTIVO_MAX}
          required={modo === 'cancelar'}
          placeholder="Ej: cambio de planes, dirección incorrecta…"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-danger-700 text-sm">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={cerrar}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
        >
          Volver
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={baja.isPending}
          className="rounded-md bg-danger-600 px-3 py-1.5 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
        >
          {baja.isPending ? textos.enCurso : textos.confirmar}
        </button>
      </div>
    </section>
  );
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  });
}

/** Aviso de solo lectura para una carga anulada o un servicio cancelado (§9). */
export function EstadoBajaCarga({
  anulacion,
  cancelacion,
}: {
  anulacion: { en: string; por_nombre: string | null; razon: string | null } | null | undefined;
  cancelacion: { en: string; razon: string | null } | null | undefined;
}) {
  if (!anulacion && !cancelacion) {
    return null;
  }
  const texto = anulacion
    ? `Anulada el ${fechaHora(anulacion.en)}${anulacion.por_nombre ? ` por ${anulacion.por_nombre}` : ''}.`
    : `Cancelada el ${fechaHora(cancelacion?.en ?? '')}.`;
  const razon = anulacion?.razon ?? cancelacion?.razon ?? null;
  return (
    <output className="block rounded-lg border border-neutral-300 bg-neutral-50 p-4 text-sm">
      <span className="block font-medium text-neutral-900">{texto}</span>
      {razon && <span className="mt-1 block text-neutral-700">Motivo: {razon}</span>}
    </output>
  );
}
