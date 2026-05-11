import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin } from 'lucide-react';
import { useEffect } from 'react';
import { env } from '../../lib/env.js';

export interface FleetMapVehicle {
  id: string;
  plate: string;
  latitude: number;
  longitude: number;
  speedKmh?: number | null;
  hasTeltonika?: boolean;
}

interface FleetMapProps {
  vehicles: FleetMapVehicle[];
  selectedId?: string | null;
  onSelectVehicle?: (vehicleId: string) => void;
  height?: number;
  /**
   * Centro/zoom default cuando no hay vehículos con posición. Default:
   * Santiago centro.
   */
  fallbackCenter?: { lat: number; lng: number };
  fallbackZoom?: number;
}

/**
 * Mapa con múltiples markers — uno por vehículo. Se auto-encuadra a los
 * markers visibles (auto-fit bounds). Usado por `/app/flota` para mostrar
 * la flota completa del transportista en una sola vista.
 *
 * Vehículos sin posición se omiten silenciosamente (no se renderiza marker).
 * Si no hay ninguno con posición → centra en `fallbackCenter` (Santiago).
 *
 * Si `VITE_GOOGLE_MAPS_API_KEY` no está configurada → fallback "Mapa no
 * disponible" (consistente con VehicleMap).
 */
export function FleetMap({
  vehicles,
  selectedId = null,
  onSelectVehicle,
  height = 480,
  fallbackCenter = { lat: -33.4489, lng: -70.6693 },
  fallbackZoom = 11,
}: FleetMapProps) {
  if (!env.VITE_GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-neutral-300 border-dashed bg-neutral-50 p-6 text-center"
        style={{ height }}
      >
        <MapPin className="h-8 w-8 text-neutral-400" aria-hidden />
        <p className="mt-2 font-medium text-neutral-700 text-sm">Mapa no disponible</p>
        <p className="mt-1 text-neutral-500 text-xs">
          La key de Google Maps no está configurada en este entorno.
        </p>
      </div>
    );
  }

  const positioned = vehicles.filter(
    (v) => Number.isFinite(v.latitude) && Number.isFinite(v.longitude),
  );

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 shadow-sm">
      <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          style={{ height, width: '100%' }}
          defaultCenter={fallbackCenter}
          defaultZoom={fallbackZoom}
          gestureHandling="cooperative"
          fullscreenControl={false}
          mapId="booster-fleet-map"
        >
          <AutoFitBounds vehicles={positioned} fallback={fallbackCenter} />
          {positioned.map((v) => (
            <AdvancedMarker
              key={v.id}
              position={{ lat: v.latitude, lng: v.longitude }}
              title={`${v.plate} · ${v.speedKmh ?? 0} km/h`}
              onClick={() => onSelectVehicle?.(v.id)}
            >
              <Pin
                background={selectedId === v.id ? '#0D6E3F' : '#1FA058'}
                borderColor={selectedId === v.id ? '#072E1B' : '#0D6E3F'}
                glyphColor="#FFFFFF"
                scale={selectedId === v.id ? 1.3 : 1}
              />
            </AdvancedMarker>
          ))}
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

/**
 * Componente interno que ajusta los bounds del mapa para encuadrar todos
 * los vehículos con posición. Se re-ejecuta cuando cambia la lista (auto-
 * follow al actualizar el polling).
 *
 * Si solo hay 1 vehículo → centra en él con un zoom razonable (no fit
 * bounds, que daría zoom max sin sentido). Si hay 0 → centra en fallback.
 */
function AutoFitBounds({
  vehicles,
  fallback,
}: {
  vehicles: FleetMapVehicle[];
  fallback: { lat: number; lng: number };
}) {
  const map = useMap();
  // useMapsLibrary nos da los constructores de `google.maps` con tipos. Sin
  // esto deberíamos declarar el `google` global a mano.
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map) {
      return;
    }
    if (vehicles.length === 0) {
      map.setCenter(fallback);
      map.setZoom(11);
      return;
    }
    if (vehicles.length === 1) {
      const v = vehicles[0];
      if (v) {
        map.setCenter({ lat: v.latitude, lng: v.longitude });
        map.setZoom(13);
      }
      return;
    }
    if (!mapsLib) {
      // Mientras carga la lib, centramos en el primer vehículo. Cuando
      // mapsLib resuelve el effect re-corre y aplica fitBounds.
      const first = vehicles[0];
      if (first) {
        map.setCenter({ lat: first.latitude, lng: first.longitude });
      }
      return;
    }
    const bounds = new mapsLib.LatLngBounds();
    for (const v of vehicles) {
      bounds.extend({ lat: v.latitude, lng: v.longitude });
    }
    map.fitBounds(bounds, 60);
  }, [map, mapsLib, vehicles, fallback]);

  return null;
}
