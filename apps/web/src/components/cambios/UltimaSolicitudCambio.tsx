import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client.js';
import { type CambiosCarga, DiffCambio } from './DiffCambio.js';

/**
 * Resultado de la última solicitud de cambio ya cerrada (editar-anular-cargas
 * §9: «Una vez resuelta, se ve el resultado y el motivo»). Se monta solo
 * cuando no hay una pendiente; la pendiente la muestra
 * `CambioPendienteGenerador`.
 *
 * Fuente: `GET /trip-requests-v2/:id/solicitudes-cambio` (la más reciente
 * primero). La query cuelga de `['cargas', tripId]`, así que se refresca con
 * las mismas invalidaciones del detalle (retirar, proponer).
 */

type EstadoSolicitud = 'pendiente' | 'aceptada' | 'rechazada' | 'retirada' | 'invalidada';

export interface SolicitudCambioVista {
  id: string;
  estado: EstadoSolicitud;
  cambios: CambiosCarga;
  valores_anteriores: CambiosCarga;
  creado_en: string;
  respondido_en: string | null;
  razon_respuesta: string | null;
  motivo_invalidacion: string | null;
  cerrado_en: string | null;
}

const TITULO: Record<Exclude<EstadoSolicitud, 'pendiente'>, string> = {
  aceptada: 'El transportista aceptó tu cambio',
  rechazada: 'El transportista rechazó tu cambio',
  retirada: 'Retiraste la solicitud de cambio',
  invalidada: 'La solicitud de cambio quedó sin efecto',
};

const MOTIVO_INVALIDACION: Record<string, string> = {
  viaje_cancelado: 'El servicio se canceló antes de que el transportista respondiera.',
  datos_cambiaron: 'Los datos de la carga cambiaron antes de que el transportista respondiera.',
  viaje_no_asignado: 'La carga ya no tenía transportista asignado.',
};

const ESTILO: Record<Exclude<EstadoSolicitud, 'pendiente'>, string> = {
  aceptada: 'border-success-200 bg-success-50 text-success-700',
  rechazada: 'border-danger-200 bg-danger-50 text-danger-700',
  retirada: 'border-neutral-200 bg-neutral-50 text-neutral-800',
  invalidada: 'border-neutral-200 bg-neutral-50 text-neutral-800',
};

const fecha = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Santiago',
});

export function UltimaSolicitudCambio({ tripId }: { tripId: string }) {
  const q = useQuery({
    queryKey: ['cargas', tripId, 'solicitudes-cambio'],
    queryFn: () =>
      api.get<{ solicitudes: SolicitudCambioVista[] }>(
        `/trip-requests-v2/${tripId}/solicitudes-cambio`,
      ),
  });
  if (q.error) {
    return (
      <p role="alert" className="text-danger-700 text-sm">
        No pudimos cargar el resultado de tu última solicitud de cambio.
      </p>
    );
  }
  const ultima = q.data?.solicitudes.find((s) => s.estado !== 'pendiente');
  if (!ultima || ultima.estado === 'pendiente') {
    return null;
  }
  const estado = ultima.estado;
  const cerrado = ultima.cerrado_en ?? ultima.respondido_en;
  const motivo =
    estado === 'invalidada'
      ? (MOTIVO_INVALIDACION[ultima.motivo_invalidacion ?? ''] ?? null)
      : ultima.razon_respuesta;
  return (
    <section
      aria-label="Resultado de la última solicitud de cambio"
      className={`space-y-2 rounded-lg border p-4 ${ESTILO[estado]}`}
    >
      <h3 className="font-semibold text-sm">{TITULO[estado]}</h3>
      {cerrado && <p className="text-xs">{fecha.format(new Date(cerrado))}</p>}
      {motivo && (
        <p className="text-sm">{estado === 'invalidada' ? motivo : `Motivo: ${motivo}`}</p>
      )}
      <DiffCambio cambios={ultima.cambios} anteriores={ultima.valores_anteriores} />
    </section>
  );
}
