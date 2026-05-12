import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, User, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Card carrier-side: asignar conductor a un assignment activo.
 *
 * Antes de este componente, los assignments se creaban con
 * driver_user_id=NULL y no había forma de setearlo después → el endpoint
 * `/assignments/:id/driver-position` era inalcanzable y la UI
 * /app/conductor/modo exigía pegar el UUID manualmente.
 *
 * Ahora el carrier (rol dueno/admin/despachador) elige uno de sus
 * conductores activos del dropdown y lo asocia con un click. El backend
 * valida que el conductor sea efectivamente del mismo carrier
 * (defensa anti-cross-tenant).
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

interface AsignarResponse {
  ok: true;
  assignment_id: string;
  previous_driver_user_id: string | null;
  new_driver_user_id: string;
  driver_name: string | null;
}

export interface DriverAssignmentCardProps {
  assignmentId: string;
  /** Nombre del conductor actualmente asignado, si hay. */
  currentDriverName: string | null;
  /** Estado actual del assignment — solo permitimos asignar en mutables. */
  assignmentStatus: string;
}

const MUTABLE_ASSIGNMENT_STATUSES = new Set(['asignado', 'recogido']);

export function DriverAssignmentCard({
  assignmentId,
  currentDriverName,
  assignmentStatus,
}: DriverAssignmentCardProps) {
  const queryClient = useQueryClient();
  const [selectedDriverUserId, setSelectedDriverUserId] = useState('');
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'success'; driverName: string | null }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const conductoresQ = useQuery<{ conductores: ConductorListItem[] }>({
    queryKey: ['conductores-list-for-assignment'],
    queryFn: () => api.get<{ conductores: ConductorListItem[] }>('/conductores'),
  });

  const isMutable = MUTABLE_ASSIGNMENT_STATUSES.has(assignmentStatus);
  if (!isMutable) {
    // Para estados terminales (entregado/cancelado) no mostramos la card.
    return null;
  }

  const conductoresActivos = (conductoresQ.data?.conductores ?? []).filter(
    (c) => c.status !== 'baja' && !c.user.is_pending,
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedDriverUserId) {
      return;
    }
    setSubmitState({ kind: 'submitting' });
    try {
      const res = await api.post<AsignarResponse>(
        `/assignments/${assignmentId}/asignar-conductor`,
        { driver_user_id: selectedDriverUserId },
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
      aria-label="Asignar conductor"
      className="border-neutral-200 border-b bg-white px-4 py-3"
      data-testid="driver-assignment-card"
    >
      <div className="flex items-start gap-3">
        <User className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <h2 className="font-semibold text-neutral-900 text-sm">
            {currentDriverName ? 'Conductor asignado' : 'Asignar conductor'}
          </h2>
          {currentDriverName ? (
            <p className="mt-1 text-neutral-700 text-sm">
              Conductor actual: <strong>{currentDriverName}</strong>
            </p>
          ) : (
            <p className="mt-1 text-neutral-600 text-sm">
              Elegí el conductor que va a hacer este viaje. Una vez asignado, podrá ver la
              asignación en su Modo Conductor y reportar su posición GPS.
            </p>
          )}

          {conductoresQ.isLoading && (
            <div className="mt-3 inline-flex items-center gap-2 text-neutral-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando conductores…
            </div>
          )}

          {conductoresQ.isError && (
            <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
              No pudimos cargar la lista de conductores. Recargá la página.
            </div>
          )}

          {!conductoresQ.isLoading && !conductoresQ.isError && conductoresActivos.length === 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs">
              No tenés conductores activos. Creá uno en{' '}
              <a href="/app/conductores/nuevo" className="underline">
                Conductores
              </a>{' '}
              antes de poder asignar.
            </div>
          )}

          {conductoresActivos.length > 0 && (
            <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select
                value={selectedDriverUserId}
                onChange={(e) => setSelectedDriverUserId(e.target.value)}
                disabled={submitState.kind === 'submitting'}
                className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                data-testid="driver-assignment-select"
              >
                <option value="">— Elegí un conductor —</option>
                {conductoresActivos.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.user.full_name ?? '(sin nombre)'} · {c.user.rut ?? 'sin RUT'}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!selectedDriverUserId || submitState.kind === 'submitting'}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
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
                    {currentDriverName ? 'Cambiar conductor' : 'Asignar'}
                  </>
                )}
              </button>
            </form>
          )}

          {submitState.kind === 'success' && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-success-200 bg-success-50 px-3 py-2 text-success-700 text-sm">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Conductor asignado: <strong>{submitState.driverName ?? '(sin nombre)'}</strong>
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
function humanizeAsignarError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'forbidden_role') {
      return 'No tenés permiso para asignar conductores. Pedile a un usuario dueño o admin que lo haga.';
    }
    if (err.code === 'driver_not_in_carrier') {
      return 'El conductor elegido no pertenece a tu empresa.';
    }
    if (err.code === 'assignment_not_mutable') {
      return 'No se puede asignar conductor: este viaje ya terminó (entregado o cancelado).';
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
