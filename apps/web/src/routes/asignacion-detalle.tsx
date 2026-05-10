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
import { BehaviorScoreCard } from '../components/scoring/BehaviorScoreCard.js';
import { DeliveryConfirmCard } from '../components/scoring/DeliveryConfirmCard.js';
import { api } from '../lib/api-client.js';

interface AssignmentDetail {
  trip_request: {
    id: string;
    tracking_code: string;
    status: string;
    origin: { address_raw: string; region_code: string };
    destination: { address_raw: string; region_code: string };
    cargo_type: string;
    cargo_weight_kg: number;
    shipper_legal_name: string | null;
  };
  assignment: {
    id: string;
    status: string;
    empresa_legal_name: string | null;
    vehicle_plate: string | null;
    vehicle_type: string | null;
    driver_name: string | null;
  };
}

export function AsignacionDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
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

  // GET /assignments/:id devuelve trip + assignment metadata.
  // Auth carrier owner se valida server-side (403 si la membership activa
  // no es dueña de este assignment).
  const tripQ = useQuery<AssignmentDetail>({
    queryKey: ['assignment-detail', assignmentId],
    queryFn: () => api.get<AssignmentDetail>(`/assignments/${assignmentId}`),
  });

  const trip = tripQ.data?.trip_request;
  const tripCode = trip?.tracking_code ?? assignmentId.slice(0, 8);
  const subtitle = trip
    ? `${trip.origin.address_raw} → ${trip.destination.address_raw}`
    : undefined;
  const isClosed = trip?.status === 'entregado' || trip?.status === 'cancelado';
  // Phase 4 PR-K4 — confirmación de entrega via voz hands-free.
  // Surface visible mientras el trip está activo (asignado | en_proceso).
  const isConfirmable = trip?.status === 'asignado' || trip?.status === 'en_proceso';
  const otroLado = trip?.shipper_legal_name ?? 'generador de carga';

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

      {/* Phase 4 PR-K4 — confirmación de entrega hands-free (voz +
          botón visual). Visible para el carrier mientras el trip está
          asignado o en_proceso. Doble confirmación dentro del componente
          previene falsos positivos. */}
      {isConfirmable && <DeliveryConfirmCard assignmentId={assignmentId} />}

      {/* Behavior score card — Phase 2 PR-I5. Solo se muestra cuando
          el trip está cerrado, porque el score se calcula post-entrega.
          Para trips en curso, el componente igual maneja el estado
          "no disponible" pero lo escondemos para no agregar ruido a
          la surface activa. */}
      {isClosed && <BehaviorScoreCard assignmentId={assignmentId} />}

      {/* ChatPanel fullscreen (sin onClose porque acá es la surface dedicada) */}
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          assignmentId={assignmentId}
          title={`Chat con ${otroLado}`}
          {...(subtitle ? { subtitle } : {})}
          readOnly={isClosed}
        />
      </div>
    </div>
  );
}
