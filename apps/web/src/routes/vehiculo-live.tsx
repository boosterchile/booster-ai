import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { LiveTrackingScreen } from '../components/map/LiveTrackingScreen.js';
import { api } from '../lib/api-client.js';

/**
 * /app/vehiculos/:id/live — pantalla full-screen estilo Uber.
 *
 * Solo accesible si el user es de la empresa dueña del vehículo (el
 * endpoint /vehiculos/:id/ubicacion ya tiene ownership check).
 *
 * Polling: 15s (más agresivo que /vehiculos/:id detail porque el contexto
 * de uso es ver-en-tiempo-real, no editar).
 */
interface UbicacionResponse {
  vehicle_id: string;
  plate: string;
  teltonika_imei: string | null;
  ubicacion: {
    timestamp_device: string;
    latitude: number | null;
    longitude: number | null;
    altitude_m: number | null;
    angle_deg: number | null;
    satellites: number | null;
    speed_kmh: number | null;
    priority: number;
  };
}

export function VehiculoLiveRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') return null;
        return <VehiculoLivePage />;
      }}
    </ProtectedRoute>
  );
}

function VehiculoLivePage() {
  const { id } = useParams({ strict: false }) as { id: string };

  const ubicacionQ = useQuery({
    queryKey: ['vehiculos', id, 'ubicacion'],
    queryFn: async () => {
      try {
        return await api.get<UbicacionResponse>(`/vehiculos/${id}/ubicacion`);
      } catch {
        return null;
      }
    },
    refetchInterval: 15_000,
  });

  return (
    <LiveTrackingScreen
      title={ubicacionQ.data?.plate ? `${ubicacionQ.data.plate} · En vivo` : 'Vehículo en vivo'}
      subtitle={
        ubicacionQ.data?.teltonika_imei
          ? `IMEI ${ubicacionQ.data.teltonika_imei}`
          : 'Sin Teltonika asociado'
      }
      backTo={`/app/vehiculos/${id}`}
      latitude={ubicacionQ.data?.ubicacion.latitude ?? null}
      longitude={ubicacionQ.data?.ubicacion.longitude ?? null}
      speedKmh={ubicacionQ.data?.ubicacion.speed_kmh ?? null}
      angleDeg={ubicacionQ.data?.ubicacion.angle_deg ?? null}
      timestampDevice={ubicacionQ.data?.ubicacion.timestamp_device ?? null}
      isLoading={ubicacionQ.isLoading}
      isFetching={ubicacionQ.isFetching}
      onRefresh={() => void ubicacionQ.refetch()}
    />
  );
}
