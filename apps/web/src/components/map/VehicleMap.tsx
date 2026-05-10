import {
  APIProvider,
  AdvancedMarker,
  ControlPosition,
  Map as GoogleMap,
  MapControl,
  Pin,
} from '@vis.gl/react-google-maps';
import { LocateFixed, MapPin } from 'lucide-react';
import { env } from '../../lib/env.js';
import { FollowVehicle, useFollowVehicle } from './use-follow-vehicle.js';

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

  return (
    <VehicleMapInner
      latitude={latitude}
      longitude={longitude}
      plate={plate}
      speedKmh={speedKmh}
      timestampDevice={timestampDevice}
      height={height}
      zoom={zoom}
      apiKey={env.VITE_GOOGLE_MAPS_API_KEY}
    />
  );
}

function VehicleMapInner({
  latitude,
  longitude,
  plate,
  speedKmh,
  timestampDevice,
  height,
  zoom,
  apiKey,
}: {
  latitude: number;
  longitude: number;
  plate: string;
  speedKmh: number | null | undefined;
  timestampDevice: Date | string | null | undefined;
  height: number;
  zoom: number;
  apiKey: string;
}) {
  const follow = useFollowVehicle();
  const center = { lat: latitude, lng: longitude };
  const tsLabel = timestampDevice
    ? `Reportado ${new Date(timestampDevice).toLocaleString('es-CL')}`
    : null;
  const speedLabel = speedKmh != null ? `${speedKmh} km/h` : 'Detenido o sin velocidad';

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 shadow-sm">
      <APIProvider apiKey={apiKey}>
        <GoogleMap
          style={{ height, width: '100%' }}
          defaultCenter={center}
          defaultZoom={zoom}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          // Pegman (street view) sí lo queremos: el operador puede arrastrarlo
          // sobre la posición del vehículo para ver contexto urbano. Como el
          // botón de Recentrar va dentro de <MapControl RIGHT_BOTTOM>, Google
          // lo apila con los demás controles del mismo cluster sin solapar.
          // Fullscreen sí lo dejamos fuera: en una vista embebida (h=320)
          // expandirlo rompería el layout de la página y no aporta valor
          // distinto al botón "Ver en vivo" que lleva al modo Uber.
          fullscreenControl={false}
          mapId="booster-vehicle-map"
        >
          <FollowVehicle
            controller={follow}
            latitude={latitude}
            longitude={longitude}
            zoom={zoom}
          />
          <AdvancedMarker position={center} title={`${plate} · ${speedLabel}`}>
            <Pin background="#1FA058" borderColor="#0D6E3F" glyphColor="#FFFFFF" />
          </AdvancedMarker>
          {!follow.following && (
            // <MapControl> integra el botón con el sistema de layout de
            // controles de Google Maps: queda apilado verticalmente sobre
            // los controles de zoom (también RIGHT_BOTTOM) y nunca se
            // solapa, sea desktop o mobile.
            <MapControl position={ControlPosition.RIGHT_BOTTOM}>
              <button
                type="button"
                onClick={follow.resume}
                className="m-2 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-neutral-200 transition hover:bg-neutral-50"
                aria-label="Recentrar mapa en el vehículo"
                title="Recentrar"
              >
                <LocateFixed className="h-5 w-5 text-neutral-700" aria-hidden />
              </button>
            </MapControl>
          )}
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
