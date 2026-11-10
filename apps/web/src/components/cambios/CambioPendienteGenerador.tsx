import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';
import { DesgloseGenerador, type DesgloseGeneradorDto } from '../comercial/SeccionComercial.js';
import { type CambiosCarga, DiffCambio } from './DiffCambio.js';

/**
 * Banner del generador mientras su propuesta espera al transportista
 * (editar-anular-cargas §9). Muestra el diff y, si cambió precio o modalidad,
 * el desglose con la tasa congelada (ADR-079 §5: solo el generador lo ve).
 */

export interface CambioPendienteGeneradorDatos {
  id: string;
  cambios: CambiosCarga;
  valores_anteriores: CambiosCarga;
  creado_en: string;
  desglose_propuesto?: Omit<DesgloseGeneradorDto, 'modalidad_carga'>;
}

export function CambioPendienteGenerador({
  tripId,
  cambio,
  puedeRetirar,
}: {
  tripId: string;
  cambio: CambioPendienteGeneradorDatos;
  puedeRetirar: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const retirar = useMutation({
    mutationFn: () =>
      api.post(`/trip-requests-v2/${tripId}/solicitudes-cambio/${cambio.id}/retirar`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cargas', tripId] }),
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === 'solicitud_no_vigente'
          ? 'El transportista ya respondió. Recarga para ver el resultado.'
          : 'No pudimos retirar la solicitud. Inténtalo de nuevo.',
      ),
  });
  const d = cambio.desglose_propuesto;
  return (
    <section
      aria-label="Cambio pendiente"
      className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <h3 className="font-semibold text-amber-900 text-sm">
        Cambio pendiente de aprobación del transportista
      </h3>
      <DiffCambio cambios={cambio.cambios} anteriores={cambio.valores_anteriores} />
      {d && <DesgloseGenerador desglose={d} />}
      {error && (
        <p role="alert" className="text-danger-700 text-sm">
          {error}
        </p>
      )}
      {puedeRetirar && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            retirar.mutate();
          }}
          disabled={retirar.isPending}
          className="rounded-md border border-amber-400 px-3 py-1.5 font-medium text-amber-900 text-sm hover:bg-amber-100 disabled:opacity-60"
        >
          {retirar.isPending ? 'Retirando…' : 'Retirar solicitud'}
        </button>
      )}
    </section>
  );
}
