import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Building2, User as UserIcon } from 'lucide-react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { LiveTrackingScreen } from '../components/map/LiveTrackingScreen.js';
import { api } from '../lib/api-client.js';

/**
 * /app/cargas/:id/track — pantalla full-screen estilo Uber para que el
 * shipper vea EN TIEMPO REAL dónde va su carga.
 *
 * Backend: GET /trip-requests-v2/:id ya devuelve assignment.ubicacion_actual
 * (último punto del vehículo asignado) — ver routes/trip-requests-v2.ts.
 *
 * Si no hay asignación todavía o el vehículo no tiene Teltonika, fallback
 * a "Sin posición GPS aún" del LiveTrackingScreen.
 */
interface TripDetailResponse {
  trip_request: {
    id: string;
    status: string;
    origin: { address_raw: string; region_code: string };
    destination: { address_raw: string; region_code: string };
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
  } | null;
}

export function CargaTrackRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') return null;
        return <CargaTrackPage />;
      }}
    </ProtectedRoute>
  );
}

function CargaTrackPage() {
  const { id } = useParams({ strict: false }) as { id: string };

  const tripQ = useQuery({
    queryKey: ['trip-requests-v2', id, 'track'],
    queryFn: async () => {
      return await api.get<TripDetailResponse>(`/trip-requests-v2/${id}`);
    },
    refetchInterval: 15_000,
  });

  const trip = tripQ.data?.trip_request;
  const assignment = tripQ.data?.assignment;
  const ubicacion = assignment?.ubicacion_actual;

  return (
    <LiveTrackingScreen
      title={
        assignment?.vehicle_plate
          ? `Carga · ${assignment.vehicle_plate}`
          : trip
            ? `Carga ${trip.id.slice(0, 8)}…`
            : 'Carga en vivo'
      }
      subtitle={
        trip
          ? `${trip.origin.address_raw} → ${trip.destination.address_raw}`
          : undefined
      }
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
        assignment ? (
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
        ) : !tripQ.isLoading ? (
          <div className="text-center text-neutral-600 text-sm">
            Esta carga todavía no tiene transportista asignado. Cuando un carrier acepte la
            oferta, vas a ver su vehículo acá en tiempo real.
          </div>
        ) : null
      }
    />
  );
}
