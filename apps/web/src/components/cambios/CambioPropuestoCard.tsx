import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';
import { type CambiosCarga, DiffCambio } from './DiffCambio.js';

/**
 * «El generador propone un cambio» en el detalle de la asignación, para la
 * oficina del transportista (editar-anular-cargas §9). Mientras está
 * pendiente la recogida queda bloqueada; aceptar aplica el cambio y rechazar
 * deja el servicio como estaba.
 */

export interface CambioPendienteOficina {
  id: string;
  cambios: CambiosCarga;
  valores_anteriores: CambiosCarga;
  creado_en: string;
}

const MOTIVO_MAX = 500;

export function mensajeErrorRespuesta(err: unknown, patente: string | null): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'solicitud_no_vigente':
        return 'Este cambio ya no está pendiente. Recarga la página para ver cómo quedó.';
      case 'solicitud_invalidada':
        return 'La carga cambió desde que se propuso este cambio y ya no aplica. Recarga la página.';
      case 'contrato_programado_no_habilitado':
        return 'El generador ya no tiene habilitado el contrato programado: este cambio no se puede aceptar. Recházalo.';
      case 'excede_capacidad_vehiculo': {
        const body = err.details as { capacidad_kg?: number } | null;
        const capacidad = body?.capacidad_kg;
        return `Este peso supera la capacidad de ${patente ?? 'tu vehículo'}${
          capacidad !== undefined ? ` (${capacidad.toLocaleString('es-CL')} kg)` : ''
        }. Asigna un vehículo con capacidad suficiente o rechaza el cambio.`;
      }
      case 'capability_denied':
        return 'Tu rol no puede responder cambios de carga.';
    }
  }
  return 'No pudimos registrar tu respuesta. Inténtalo de nuevo.';
}

export function CambioPropuestoCard({
  assignmentId,
  cambio,
  puedeResponder,
  vehiclePlate,
  vehicleCapacityKg = null,
}: {
  assignmentId: string;
  cambio: CambioPendienteOficina;
  puedeResponder: boolean;
  vehiclePlate: string | null;
  /** Capacidad del vehículo asignado; con ella se avisa antes de aceptar (§12-P9). */
  vehicleCapacityKg?: number | null;
}) {
  const queryClient = useQueryClient();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const base = `/assignments/${assignmentId}/solicitudes-cambio/${cambio.id}`;
  const alTerminar = () =>
    queryClient.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] });

  const aceptar = useMutation({
    mutationFn: () => api.post(`${base}/aceptar`, {}),
    onSuccess: alTerminar,
    onError: (err) => setError(mensajeErrorRespuesta(err, vehiclePlate)),
  });
  const rechazar = useMutation({
    mutationFn: () => {
      const m = motivo.trim();
      return api.post(`${base}/rechazar`, m ? { reason: m } : {});
    },
    onSuccess: alTerminar,
    onError: (err) => setError(mensajeErrorRespuesta(err, vehiclePlate)),
  });
  const ocupado = aceptar.isPending || rechazar.isPending;
  const pesoPropuesto = cambio.cambios.weight_kg;
  const excedeCapacidad =
    typeof pesoPropuesto === 'number' &&
    typeof vehicleCapacityKg === 'number' &&
    pesoPropuesto > vehicleCapacityKg;

  return (
    <section
      aria-labelledby={`cambio-${cambio.id}`}
      data-testid="cambio-propuesto"
      className="border-amber-300 border-b bg-amber-50 px-4 py-4"
    >
      <h2 id={`cambio-${cambio.id}`} className="font-semibold text-amber-900 text-sm">
        El generador propone un cambio
      </h2>
      <p className="mt-1 text-amber-900 text-sm">
        No podrás confirmar la recogida hasta responder.
      </p>
      <div className="mt-3 rounded-md bg-white p-3">
        <DiffCambio cambios={cambio.cambios} anteriores={cambio.valores_anteriores} />
      </div>
      {excedeCapacidad && vehicleCapacityKg !== null && (
        <p data-testid="excede-capacidad" className="mt-3 text-danger-800 text-sm">
          Este peso supera la capacidad de {vehiclePlate ?? 'tu vehículo'} (
          {vehicleCapacityKg.toLocaleString('es-CL')} kg). Asigna un vehículo con capacidad
          suficiente o rechaza el cambio.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-danger-700 text-sm">
          {error}
        </p>
      )}
      {puedeResponder && !rechazando && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              setError(null);
              aceptar.mutate();
            }}
            className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {aceptar.isPending ? 'Aceptando…' : 'Aceptar cambio'}
          </button>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              setError(null);
              setRechazando(true);
            }}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-800 text-sm"
          >
            Rechazar
          </button>
        </div>
      )}
      {puedeResponder && rechazando && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm">
            <span className="font-medium text-neutral-800">Motivo (opcional)</span>
            <input
              type="text"
              value={motivo}
              maxLength={MOTIVO_MAX}
              onChange={(ev) => setMotivo(ev.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                setError(null);
                rechazar.mutate();
              }}
              className="rounded-md bg-danger-600 px-4 py-2 font-medium text-sm text-white disabled:opacity-60"
            >
              {rechazar.isPending ? 'Rechazando…' : 'Rechazar cambio'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRechazando(false);
                setMotivo('');
              }}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-neutral-700 text-sm"
            >
              Volver
            </button>
          </div>
        </div>
      )}
      {!puedeResponder && (
        <p className="mt-3 text-neutral-600 text-sm">
          Solo quien puede aceptar ofertas en tu empresa responde este cambio.
        </p>
      )}
    </section>
  );
}
