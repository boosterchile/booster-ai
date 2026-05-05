import { APIProvider, AdvancedMarker, Map as GoogleMap, Pin } from '@vis.gl/react-google-maps';
import { MapPin } from 'lucide-react';
import { env } from '../../lib/env.js';

/**
 * Componente reusable para mostrar la ubicación actual de UN vehículo en
 * un mapa Google. Usado por:
 *   - /app/vehiculos/:id (transportista ve su vehículo)
 *   - /app/cargas/:id (shipper ve dónde va su carga)
 *
 * Si VITE_GOOGLE_MAPS_API_KEY no está configurada, render fallback
 * "Mapa no disponible".
 *
 * Si lat/lng son null (sin telemetría), render placeholder amigable.
 *
 * Polling: el caller debe re-fetchear y pasar props nuevos. El componente
 * actualiza el marker reactivamente.
 */
export function VehicleMap({
  latitude,
  longitude,
  plate,
  speedKmh,
  timestampDevice,
  height = 320,
  zoom = 14,
}: {
  latitude: number | null;
  longitude: number | null;
  plate: string;
  speedKmh?: number | null;
  timestampDevice?: Date | string | null;
  height?: number;
  zoom?: number;
}) {
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

  if (latitude == null || longitude == null) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-neutral-300 border-dashed bg-neutral-50 p-6 text-center"
        style={{ height }}
      >
        <MapPin className="h-8 w-8 text-neutral-400" aria-hidden />
        <p className="mt-2 font-medium text-neutral-700 text-sm">Sin posición GPS aún</p>
        <p className="mt-1 text-neutral-500 text-xs">
          El dispositivo no ha reportado coordenadas. Si recién se asoció, los primeros puntos
          pueden tardar unos segundos.
        </p>
      </div>
    );
  }

  const center = { lat: latitude, lng: longitude };
  const tsLabel = timestampDevice
    ? `Reportado ${new Date(timestampDevice).toLocaleString('es-CL')}`
    : null;
  const speedLabel = speedKmh != null ? `${speedKmh} km/h` : 'Detenido o sin velocidad';

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 shadow-sm">
      <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          style={{ height }}
          defaultCenter={center}
          defaultZoom={zoom}
          center={center}
          zoom={zoom}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          mapId="booster-vehicle-map"
        >
          <AdvancedMarker position={center} title={`${plate} · ${speedLabel}`}>
            <Pin background="#1FA058" borderColor="#0D6E3F" glyphColor="#FFFFFF" />
          </AdvancedMarker>
        </GoogleMap>
      </APIProvider>
      <div className="flex items-center justify-between gap-4 border-neutral-100 border-t bg-white px-4 py-2 text-neutral-700 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-neutral-900">{plate}</span>
          <span>·</span>
          <span>{speedLabel}</span>
        </div>
        {tsLabel && <span className="text-neutral-500">{tsLabel}</span>}
      </div>
    </div>
  );
}
