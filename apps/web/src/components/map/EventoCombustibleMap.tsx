import { APIProvider, AdvancedMarker, Map as GoogleMap, Pin } from '@vis.gl/react-google-maps';
import { MapPin } from 'lucide-react';
import { env } from '../../lib/env.js';

/**
 * Mapa del aviso de posible robo de combustible.
 * El caller solo lo monta cuando hay `event_lat` y `event_lon` reales:
 * el centro y el pin son ese punto, sin fallback a otra coordenada.
 */
export function EventoCombustibleMap({
  latitude,
  longitude,
  height = 320,
}: {
  latitude: number;
  longitude: number;
  height?: number;
}) {
  if (!env.VITE_GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-neutral-300 border-dashed bg-neutral-50 p-6 text-center"
        style={{ height }}
        data-testid="mapa-evento-sin-key"
      >
        <MapPin className="h-8 w-8 text-neutral-400" aria-hidden />
        <p className="mt-2 font-medium text-neutral-700 text-sm">Mapa no disponible</p>
        <p className="mt-1 text-neutral-500 text-xs">
          La key de Google Maps no está configurada en este entorno.
        </p>
      </div>
    );
  }

  const center = { lat: latitude, lng: longitude };

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200" data-testid="mapa-evento">
      <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          style={{ height, width: '100%' }}
          defaultCenter={center}
          defaultZoom={16}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          fullscreenControl={false}
          mapId="booster-evento-combustible"
        >
          <AdvancedMarker position={center} title="Posible robo de combustible">
            <Pin background="#D97706" borderColor="#92400E" glyphColor="#FFFFFF" />
          </AdvancedMarker>
        </GoogleMap>
      </APIProvider>
    </div>
  );
}
