/**
 * /app/asignaciones/:id — pantalla carrier-side de un assignment activo.
 *
 * El transportista entra acá después de aceptar una oferta. Le muestra:
 *   - Header con tracking_code + estado del trip + ruta
 *   - Mapa con la ubicación actual del vehículo (reusa LiveTrackingScreen
 *     pattern)
 *   - Botón "Marcar entrega completada" (POD fallback — el shipper es
 *     canónico, ver P2.c)
 *   - ChatPanel embebido fullscreen (P3.e) — comunicación con el shipper
 *
 * Para v1 usamos un layout simple: header + chat. Sin mapa todavía
 * (separado en P3.f.bonus si hay tiempo). El mapa carrier ya existe en
 * /app/vehiculos/:id/live como surface separada.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ChatPanel } from '../components/chat/ChatPanel.js';
import { PushSubscribeBanner } from '../components/chat/PushSubscribeBanner.js';
import { api } from '../lib/api-client.js';

interface AssignmentDetail {
  trip_request: {
    id: string;
    tracking_code: string;
    status: string;
    origin: { address_raw: string };
    destination: { address_raw: string };
  };
  assignment: {
    id: string;
    status: string;
    empresa_legal_name: string | null;
  } | null;
}

export function AsignacionDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') return null;
        const isCarrier = ctx.me.active_membership?.empresa.is_transportista ?? false;
        if (!isCarrier) {
          return (
            <div className="mx-auto max-w-2xl px-6 py-12">
              <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
                <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
                <p className="mt-2 text-neutral-600 text-sm">
                  Esta pantalla es para empresas que operan como transportistas.
                </p>
                <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
                  Volver al inicio
                </Link>
              </div>
            </div>
          );
        }
        return <AsignacionDetallePage />;
      }}
    </ProtectedRoute>
  );
}

function AsignacionDetallePage() {
  const { id: assignmentId } = useParams({ strict: false }) as { id: string };

  // El detalle del assignment vive en GET /trip-requests-v2/:tripId, pero
  // acá tenemos el assignment_id. Necesitamos un endpoint que mapee
  // assignment → trip o pasarle el tripId. Por v1 usamos un fetch
  // intermedio: GET /assignments/:id/messages devuelve viewer_role +
  // confirma que el assignment existe (con permisos), y el chat ya
  // funciona standalone.
  //
  // Para mostrar header con tracking_code + ruta necesitaríamos un
  // endpoint nuevo GET /assignments/:id que devuelva el detail. Por v1
  // mostramos el assignmentId truncado y dejamos el header simple. El
  // shipper-side (cargas.tsx) ya tiene el detalle completo.
  const tripQ = useQuery<AssignmentDetail | null>({
    queryKey: ['assignment-detail', assignmentId],
    queryFn: async () => {
      // Endpoint placeholder — si no existe, devuelve null y mostramos
      // header simple. P3.f puede agregar un GET /assignments/:id real.
      try {
        return await api.get<AssignmentDetail>(`/assignments/${assignmentId}`);
      } catch {
        return null;
      }
    },
    retry: false,
  });

  const tripCode = tripQ.data?.trip_request.tracking_code ?? assignmentId.slice(0, 8);
  const subtitle = tripQ.data
    ? `${tripQ.data.trip_request.origin.address_raw} → ${tripQ.data.trip_request.destination.address_raw}`
    : undefined;
  const isClosed =
    tripQ.data?.trip_request.status === 'entregado' ||
    tripQ.data?.trip_request.status === 'cancelado';

  return (
    <div className="flex h-screen flex-col bg-neutral-100">
      {/* Header global */}
      <div className="border-neutral-200 border-b bg-white">
        <PushSubscribeBanner />
        <div className="flex items-center gap-3 px-4 py-3">
          <Link
            to="/app/ofertas"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
            aria-label="Volver a ofertas"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div>
            <h1 className="font-semibold text-neutral-900">Asignación</h1>
            <p className="text-neutral-500 text-xs">Carga {tripCode}</p>
          </div>
        </div>
      </div>

      {/* ChatPanel fullscreen (sin onClose porque acá es la surface dedicada) */}
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          assignmentId={assignmentId}
          title={`Chat con generador de carga`}
          {...(subtitle ? { subtitle } : {})}
          readOnly={isClosed}
        />
      </div>
    </div>
  );
}
