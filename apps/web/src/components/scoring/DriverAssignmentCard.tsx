import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, User, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';
import { useEmpresaScope } from '../../lib/empresa-activa.js';

/**
 * Card carrier-side: asignar conductor a un assignment activo.
 *
 * Antes de este componente, los assignments se creaban con
 * driver_user_id=NULL y no había forma de setearlo después → el endpoint
 * `/assignments/:id/driver-position` era inalcanzable y la UI
 * /app/conductor exigía pegar el UUID manualmente.
 *
 * Ahora el carrier (rol dueno/admin/despachador) elige un camión de su
 * flota y un conductor —incluido el que todavía no activó su cuenta—
 * y los confirma. El backend valida que ambos sean de la misma empresa.
 *
 * Visible mientras el assignment esté en estado mutable
 * (`asignado` | `recogido`). Permite reasignar (caso de uso: relevo de
 * chofer mid-trip).
 */

interface ConductorListItem {
  id: string;
  user_id: string;
  user: {
    id: string;
    full_name: string | null;
    rut: string | null;
    is_pending: boolean;
  };
  status: string;
}

interface VehiculoListItem {
  id: string;
  plate: string;
  type: string;
  unit_category: string;
  status: string;
}

interface AsignarResponse {
  ok: true;
  assignment_id: string;
  previous_driver_user_id: string | null;
  new_driver_user_id: string;
  driver_name: string | null;
  driver_pending?: boolean;
  new_vehicle_id?: string;
}

export interface DriverAssignmentCardProps {
  assignmentId: string;
  /** Nombre del conductor actualmente asignado, si hay. */
  currentDriverName: string | null;
  /** Camión que quedó en la oferta, para preseleccionarlo. */
  currentVehicleId?: string | null;
  /** Estado actual del assignment — solo permitimos asignar en mutables. */
  assignmentStatus: string;
}

const MUTABLE_ASSIGNMENT_STATUSES = new Set(['asignado', 'recogido']);

export function DriverAssignmentCard({
  assignmentId,
  currentDriverName,
  currentVehicleId = null,
  assignmentStatus,
}: DriverAssignmentCardProps) {
  const queryClient = useQueryClient();
  const [selectedDriverUserId, setSelectedDriverUserId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState(currentVehicleId ?? '');
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'success'; driverName: string | null }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const scope = useEmpresaScope();
  const conductoresQ = useQuery<{ conductores: ConductorListItem[] }>({
    queryKey: scope.key('conductores-list-for-assignment'),
    queryFn: () => api.get<{ conductores: ConductorListItem[] }>('/conductores', scope.init),
  });
  const puedeElegirCamion = assignmentStatus === 'asignado';
  const vehiculosQ = useQuery<{ vehicles: VehiculoListItem[] }>({
    queryKey: scope.key('vehiculos'),
    queryFn: () => api.get<{ vehicles: VehiculoListItem[] }>('/vehiculos', scope.init),
    enabled: puedeElegirCamion,
  });

  const isMutable = MUTABLE_ASSIGNMENT_STATUSES.has(assignmentStatus);
  if (!isMutable) {
    // Para estados terminales (entregado/cancelado) no mostramos la card.
    return null;
  }

  // `baja` no está en el enum, pero el soft-delete histórico se seguía
  // escondiendo acá. La activación pendiente NO se esconde: el despachador
  // tiene que poder asignar a quien todavía no creó su clave.
  const conductoresAsignables = (conductoresQ.data?.conductores ?? []).filter(
    (c) => c.status !== 'baja',
  );
  const camiones = (vehiculosQ.data?.vehicles ?? []).filter(
    (v) => v.status === 'activo' && v.unit_category !== 'arrastre',
  );
  const listasListas =
    !conductoresQ.isLoading &&
    !conductoresQ.isError &&
    (!puedeElegirCamion || (!vehiculosQ.isLoading && !vehiculosQ.isError));
  const puedeConfirmar =
    selectedDriverUserId !== '' && (!puedeElegirCamion || selectedVehicleId !== '');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedDriverUserId || (puedeElegirCamion && !selectedVehicleId)) {
      return;
    }
    setSubmitState({ kind: 'submitting' });
    try {
      const res = await api.post<AsignarResponse>(
        `/assignments/${assignmentId}/asignar-conductor`,
        puedeElegirCamion
          ? { driver_user_id: selectedDriverUserId, vehiculo_id: selectedVehicleId }
          : { driver_user_id: selectedDriverUserId },
      );
      setSubmitState({ kind: 'success', driverName: res.driver_name });
      // Invalidar el query del detalle del assignment para refrescar
      // el driver_name visible en el header.
      await queryClient.invalidateQueries({
        queryKey: ['assignment-detail', assignmentId],
      });
    } catch (err) {
      const msg = humanizeAsignarError(err);
      setSubmitState({ kind: 'error', message: msg });
    }
  }

  return (
    <section
      aria-label="Asignar camión y conductor"
      className="min-w-0 max-w-full border-neutral-200 border-b bg-white px-4 py-3"
      data-testid="driver-assignment-card"
    >
      <div className="flex min-w-0 items-start gap-3">
        <User className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        {/* min-w-0: sin esto el <select> de conductor usa el ancho de la
            opción más larga (nombre + RUT) y la fila flex se sale del viewport. */}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-neutral-900 text-sm">
            {currentDriverName ? 'Camión y conductor' : 'Asignar camión y conductor'}
          </h2>
          {currentDriverName ? (
            <p className="mt-1 break-words text-neutral-700 text-sm">
              Conductor actual: <strong>{currentDriverName}</strong>
            </p>
          ) : null}

          {(conductoresQ.isLoading || (puedeElegirCamion && vehiculosQ.isLoading)) && (
            <div className="mt-3 inline-flex items-center gap-2 text-neutral-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando flota y conductores…
            </div>
          )}

          {(conductoresQ.isError || (puedeElegirCamion && vehiculosQ.isError)) && (
            <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
              No pudimos cargar la flota o los conductores. Recarga la página.
            </div>
          )}

          {listasListas && conductoresAsignables.length === 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs">
              No tienes conductores activos. Crea uno en{' '}
              <a href="/app/conductores/nuevo" className="underline">
                Conductores
              </a>{' '}
              antes de poder asignar.
            </div>
          )}

          {listasListas &&
            puedeElegirCamion &&
            conductoresAsignables.length > 0 &&
            camiones.length === 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs">
                No tienes camiones activos en la flota. Agrega uno en Vehículos antes de confirmar.
              </div>
            )}

          {listasListas &&
            conductoresAsignables.length > 0 &&
            (!puedeElegirCamion || camiones.length > 0) && (
              <form onSubmit={handleSubmit} className="mt-3 flex min-w-0 flex-col gap-2">
                {puedeElegirCamion && (
                  <label
                    className="flex min-w-0 flex-col gap-1 text-neutral-700 text-sm"
                    htmlFor="vehicle-assignment-select"
                  >
                    Camión
                    <select
                      id="vehicle-assignment-select"
                      value={selectedVehicleId}
                      onChange={(e) => setSelectedVehicleId(e.target.value)}
                      disabled={submitState.kind === 'submitting'}
                      className="w-full min-w-0 max-w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                      data-testid="vehicle-assignment-select"
                    >
                      <option value="">— Elige un camión —</option>
                      {camiones.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plate}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label
                  className="flex min-w-0 flex-col gap-1 text-neutral-700 text-sm"
                  htmlFor="driver-assignment-select"
                >
                  Conductor
                  <select
                    id="driver-assignment-select"
                    value={selectedDriverUserId}
                    onChange={(e) => setSelectedDriverUserId(e.target.value)}
                    disabled={submitState.kind === 'submitting'}
                    className="w-full min-w-0 max-w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    data-testid="driver-assignment-select"
                  >
                    <option value="">— Elige un conductor —</option>
                    {conductoresAsignables.map((c) => (
                      <option key={c.user_id} value={c.user_id}>
                        {etiquetaConductor(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={!puedeConfirmar || submitState.kind === 'submitting'}
                  className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                  data-testid="driver-assignment-submit"
                >
                  {submitState.kind === 'submitting' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Asignando…
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Confirmar
                    </>
                  )}
                </button>
              </form>
            )}

          {submitState.kind === 'success' && (
            <div className="mt-3 flex min-w-0 items-start gap-2 rounded-md border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                Conductor asignado: <strong>{submitState.driverName ?? '(sin nombre)'}</strong>
              </span>
            </div>
          )}

          {submitState.kind === 'error' && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{submitState.message}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Traduce errores del API a mensajes operacionales sin códigos crudos.
 */
function etiquetaConductor(c: ConductorListItem): string {
  const base = `${c.user.full_name ?? '(sin nombre)'} · ${c.user.rut ?? 'sin RUT'}`;
  return c.user.is_pending ? `${base} · pendiente de activación` : base;
}

function humanizeAsignarError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'forbidden_role') {
      return 'No tienes permiso para asignar conductores. Pídele a un usuario dueño o admin que lo haga.';
    }
    if (err.code === 'driver_not_in_carrier') {
      return 'El conductor elegido no pertenece a tu empresa.';
    }
    if (err.code === 'assignment_not_mutable') {
      return 'No se puede asignar conductor: este viaje ya terminó (entregado o cancelado).';
    }
    if (err.code === 'vehicle_not_assignable') {
      const reason =
        err.details && typeof err.details === 'object' && 'reason' in err.details
          ? err.details.reason
          : null;
      if (reason === 'en_transito') {
        return 'El camión no se puede cambiar: la carga ya va en ruta.';
      }
      return 'Ese camión no está disponible en la flota de tu empresa.';
    }
    if (err.code === 'assignment_not_found') {
      return 'La asignación no existe.';
    }
    if (err.code === 'forbidden_owner_mismatch') {
      return 'Esta asignación no es de tu empresa.';
    }
    return `${err.status}: ${err.message}`;
  }
  return (err as Error).message;
}
