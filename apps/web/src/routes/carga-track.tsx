import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Building2, MessageCircle, User as UserIcon, X } from 'lucide-react';
import { useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ChatPanel } from '../components/chat/ChatPanel.js';
import { PushSubscribeBanner } from '../components/chat/PushSubscribeBanner.js';
import { InstruccionesRetiroPanel } from '../components/instrucciones-retiro/InstruccionesRetiroPanel.js';
import { LiveTrackingScreen } from '../components/map/LiveTrackingScreen.js';
import { PublicTrackingShare } from '../components/public-tracking-share.js';
import { TransportDocumentsPanel } from '../components/transport-documents/TransportDocumentsPanel.js';
import { useRefetchWhenVisible } from '../hooks/use-refetch-when-visible.js';
import { api } from '../lib/api-client.js';
import { flagsDe } from '../lib/capacidades.js';
import {
  LIVE_TRACKING_FETCH,
  LIVE_TRACKING_QUERY,
  type PositionSource,
  etaLine,
  positionSourceLabel,
  publicTrackingShareUrl,
} from '../lib/live-tracking.js';
import { canWriteTransportDocuments } from '../lib/transport-documents-api.js';

/**
 * /app/cargas/:id/track — pantalla full-screen estilo Uber para que el
 * shipper vea EN TIEMPO REAL dónde va su carga.
 *
 * Backend: GET /trip-requests-v2/:id devuelve assignment.ubicacion_actual
 * (última posición viva: GPS del vehículo si reportó hace <30 min o, si no,
 * teléfono del conductor), assignment.position_source y assignment.eta_minutes
 * — ver routes/trip-requests-v2.ts y `.specs/tracking-live-unificado/`.
 *
 * Si no hay asignación todavía o nadie reporta posición fresca, fallback a
 * "Sin posición GPS aún" del LiveTrackingScreen.
 */
interface TripDetailResponse {
  trip_request: {
    id: string;
    status: string;
    origin_address_raw: string;
    origin_region_code: string;
    destination_address_raw: string;
    destination_region_code: string;
  };
  assignment: {
    id: string;
    status: string;
    empresa_legal_name: string | null;
    vehicle_plate: string | null;
    vehicle_type: string | null;
    driver_name: string | null;
    ubicacion_actual: {
      timestamp_device: string;
      latitude: number | null;
      longitude: number | null;
      speed_kmh: number | null;
      angle_deg: number | null;
    } | null;
    /** Opcionales: un API anterior a `tracking-live-unificado` no los envía. */
    position_source?: PositionSource | null;
    eta_minutes?: number | null;
    /** UUID del seguimiento público. Null en asignaciones anteriores a la columna. */
    public_tracking_token?: string | null;
    /** La ruta lleva otras cargas (ruta-parada-servicio §4.6). Ausente en un API anterior. */
    viaja_consolidada?: boolean;
  } | null;
}

export function CargaTrackRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const canWriteDocs = canWriteTransportDocuments(ctx.me.active_membership?.role);
        // instrucciones-retiro: las carga quien puede publicar cargas.
        const canWriteRetiro = flagsDe(ctx.me).publicarCarga;
        return <CargaTrackPage canWriteDocs={canWriteDocs} canWriteRetiro={canWriteRetiro} />;
      }}
    </ProtectedRoute>
  );
}

function CargaTrackPage({
  canWriteDocs,
  canWriteRetiro,
}: {
  canWriteDocs: boolean;
  canWriteRetiro: boolean;
}) {
  const { id } = useParams({ strict: false }) as { id: string };
  const [chatOpen, setChatOpen] = useState(false);

  const tripQ = useQuery({
    queryKey: ['trip-requests-v2', id, 'track'],
    queryFn: async () => {
      return await api.get<TripDetailResponse>(`/trip-requests-v2/${id}`, LIVE_TRACKING_FETCH);
    },
    refetchInterval: 15_000,
    ...LIVE_TRACKING_QUERY,
  });
  useRefetchWhenVisible(() => void tripQ.refetch(), id.length > 0);

  const trip = tripQ.data?.trip_request;
  const assignment = tripQ.data?.assignment;
  const ubicacion = assignment?.ubicacion_actual;
  const isClosed = trip?.status === 'entregado' || trip?.status === 'cancelado';
  const hasPos = ubicacion?.latitude != null && ubicacion?.longitude != null;
  const sourceLabel = positionSourceLabel(assignment?.position_source);
  const shareUrl = publicTrackingShareUrl(
    assignment?.public_tracking_token,
    trip?.status,
    window.location.origin,
  );

  return (
    <>
      <LiveTrackingScreen
        title={
          assignment?.vehicle_plate
            ? `Carga · ${assignment.vehicle_plate}`
            : trip
              ? `Carga ${trip.id.slice(0, 8)}…`
              : 'Carga en vivo'
        }
        subtitle={trip ? `${trip.origin_address_raw} → ${trip.destination_address_raw}` : undefined}
        backTo={`/app/cargas/${id}`}
        latitude={ubicacion?.latitude ?? null}
        longitude={ubicacion?.longitude ?? null}
        speedKmh={ubicacion?.speed_kmh ?? null}
        angleDeg={ubicacion?.angle_deg ?? null}
        timestampDevice={ubicacion?.timestamp_device ?? null}
        isLoading={tripQ.isLoading}
        isFetching={tripQ.isFetching}
        onRefresh={() => void tripQ.refetch()}
        bottomExtra={
          <div className="space-y-3">
            {assignment ? (
              <div className="space-y-2">
                {assignment.viaja_consolidada && (
                  <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2">
                    <p className="font-medium text-neutral-900 text-sm">Viaja con otras cargas</p>
                    <p className="text-neutral-600 text-xs">
                      La ubicación se muestra entre la recogida y la entrega de tu carga.
                    </p>
                  </div>
                )}
                {hasPos && (
                  <div>
                    <p className="font-semibold text-neutral-900 text-sm">
                      {etaLine(assignment.eta_minutes)}
                    </p>
                    {sourceLabel && <p className="text-neutral-600 text-xs">{sourceLabel}</p>}
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 text-sm">
                  <div className="flex items-center gap-2 text-neutral-700">
                    <Building2 className="h-4 w-4 text-neutral-500" aria-hidden />
                    <span>{assignment.empresa_legal_name ?? '—'}</span>
                  </div>
                  {assignment.driver_name && (
                    <div className="flex items-center gap-2 text-neutral-700">
                      <UserIcon className="h-4 w-4 text-neutral-500" aria-hidden />
                      <span>{assignment.driver_name}</span>
                    </div>
                  )}
                  <Link
                    to="/app/cargas/$id"
                    params={{ id }}
                    className="rounded-md border border-neutral-300 px-3 py-1 font-medium text-neutral-700 text-xs transition hover:bg-neutral-100"
                  >
                    Ver detalle
                  </Link>
                </div>
              </div>
            ) : tripQ.isLoading ? null : (
              <div className="text-center text-neutral-600 text-sm">
                Esta carga todavía no tiene transportista asignado. Cuando un carrier acepte la
                oferta, verás su vehículo aquí en tiempo real.
              </div>
            )}
            {shareUrl && <PublicTrackingShare url={shareUrl} />}
            <InstruccionesRetiroPanel tripId={id} canWrite={canWriteRetiro} />
            <TransportDocumentsPanel tripId={id} canWrite={canWriteDocs} compact />
          </div>
        }
      />
      {/* FAB chat — solo si hay assignment activo. */}
      {assignment && !chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed right-6 bottom-24 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg transition hover:bg-primary-700"
          aria-label="Abrir chat con transportista"
        >
          <MessageCircle className="h-6 w-6" aria-hidden />
        </button>
      )}
      {/* Drawer chat. Overlay sobre el mapa, full height en mobile, sidebar en desktop. */}
      {assignment && chatOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setChatOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setChatOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl [&:not(:has([data-push-banner]))]:pt-safe"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <PushSubscribeBanner />
            <div className="flex items-center justify-between border-neutral-200 border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-neutral-900">
                  Chat con {assignment.empresa_legal_name ?? 'transportista'}
                </h3>
                {trip && (
                  <p className="truncate text-neutral-500 text-xs">Carga {trip.id.slice(0, 8)}…</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                aria-label="Cerrar chat"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatPanel assignmentId={assignment.id} title="" readOnly={isClosed} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
