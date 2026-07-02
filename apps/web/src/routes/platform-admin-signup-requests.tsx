import { Link } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, RotateCcwIcon, UserPlusIcon, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * T10 SEC-001 Sprint 2b — `/app/platform-admin/signup-requests`
 * (sec-001-cierre §3 H1.2 SC-1.2.1 completion; ADR-052).
 *
 * Dashboard admin para procesar signup-requests en estado
 * `pendiente_aprobacion`. Approve crea el Firebase User vía backend Admin
 * SDK + INSERT users + notify user; Reject solo marca rechazado.
 *
 * Auth: BOOSTER_PLATFORM_ADMIN_EMAILS allowlist (403 si no en la lista).
 * Server-side enforcement; UI muestra error genérico si 403.
 *
 * Feature flag: si `SIGNUP_REQUEST_FLOW_ACTIVATED=false`, el backend
 * retorna 503 + `code: signup_flow_disabled` → UI muestra "Coming soon".
 *
 * Single-file pattern paridad `platform-admin-observability.tsx`.
 */

interface SignupRequest {
  id: string;
  email: string;
  nombre_completo: string;
  estado: 'pendiente_aprobacion' | 'aprobado' | 'rechazado';
  solicitado_en: string;
}

interface ListResponse {
  signup_requests: SignupRequest[];
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; requests: SignupRequest[] }
  | { kind: 'coming_soon' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export function PlatformAdminSignupRequestsRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => <PlatformAdminSignupRequestsPage />}
    </ProtectedRoute>
  );
}

function PlatformAdminSignupRequestsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await api.get<ListResponse>('/admin/signup-requests');
      setState({ kind: 'loaded', requests: res.signup_requests });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 503 && err.code === 'signup_flow_disabled') {
          setState({ kind: 'coming_soon' });
          return;
        }
        if (err.status === 403) {
          setState({ kind: 'forbidden' });
          return;
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message: msg });
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleApprove = useCallback(
    async (req: SignupRequest) => {
      if (!confirm(`Aprobar a ${req.email} (${req.nombre_completo})?`)) {
        return;
      }
      setActionInFlight(req.id);
      try {
        await api.post(`/admin/signup-requests/${req.id}/approve`, {});
        await fetchList();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Error al aprobar: ${msg}`);
      } finally {
        setActionInFlight(null);
      }
    },
    [fetchList],
  );

  const handleReject = useCallback(
    async (req: SignupRequest) => {
      const reason = prompt(`Motivo del rechazo para ${req.email} (opcional):`);
      if (reason === null) {
        // User canceled.
        return;
      }
      setActionInFlight(req.id);
      try {
        await api.post(`/admin/signup-requests/${req.id}/reject`, {
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        await fetchList();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Error al rechazar: ${msg}`);
      } finally {
        setActionInFlight(null);
      }
    },
    [fetchList],
  );

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <UserPlusIcon className="h-6 w-6 text-primary-600" aria-hidden />
            <div>
              <div className="font-semibold text-neutral-900">Solicitudes de registro</div>
              <div className="text-neutral-500 text-xs">
                Aprobar o rechazar nuevas cuentas (admin-approval gate · ADR-052)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchList()}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
              disabled={state.kind === 'loading'}
            >
              <RotateCcwIcon className="h-4 w-4" aria-hidden />
              Refrescar
            </button>
            <Link
              to="/app/platform-admin"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Volver
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {state.kind === 'idle' || state.kind === 'loading' ? (
          <div className="rounded border border-neutral-200 bg-white p-8 text-center text-neutral-500">
            Cargando…
          </div>
        ) : state.kind === 'coming_soon' ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-8 text-center">
            <div className="font-semibold text-amber-900">Próximamente</div>
            <p className="mt-2 text-amber-800 text-sm">
              El flow de aprobación de signup-requests está deshabilitado (
              <code className="rounded bg-amber-100 px-1">SIGNUP_REQUEST_FLOW_ACTIVATED=false</code>
              ). Flipear la flag en config para activar.
            </p>
          </div>
        ) : state.kind === 'forbidden' ? (
          <div className="rounded border border-red-200 bg-red-50 p-8 text-center">
            <div className="font-semibold text-red-900">Acceso restringido</div>
            <p className="mt-2 text-red-800 text-sm">
              Solo platform-admins (BOOSTER_PLATFORM_ADMIN_EMAILS) pueden acceder.
            </p>
          </div>
        ) : state.kind === 'error' ? (
          <div className="rounded border border-red-200 bg-red-50 p-8 text-center">
            <div className="font-semibold text-red-900">Error al cargar</div>
            <p className="mt-2 text-red-800 text-sm">{state.message}</p>
          </div>
        ) : state.requests.length === 0 ? (
          <div className="rounded border border-neutral-200 bg-white p-8 text-center text-neutral-500">
            Sin solicitudes pendientes.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-neutral-200 bg-white">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-neutral-700">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">Nombre</th>
                  <th className="px-4 py-2 text-left font-medium">Solicitado</th>
                  <th className="px-4 py-2 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {state.requests.map((req) => {
                  const busy = actionInFlight === req.id;
                  return (
                    <tr key={req.id} className={busy ? 'opacity-50' : undefined}>
                      <td className="px-4 py-2 font-mono text-neutral-900 text-xs">{req.email}</td>
                      <td className="px-4 py-2 text-neutral-900">{req.nombre_completo}</td>
                      <td className="px-4 py-2 text-neutral-600">
                        {new Date(req.solicitado_en).toLocaleString('es-CL')}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleApprove(req)}
                          disabled={busy}
                          className="mr-2 inline-flex cursor-pointer items-center gap-1 rounded-md bg-green-600 px-3 py-1 font-medium text-white text-xs transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          Aprobar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReject(req)}
                          disabled={busy}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-red-600 px-3 py-1 font-medium text-white text-xs transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <XCircle className="h-3 w-3" aria-hidden />
                          Rechazar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
