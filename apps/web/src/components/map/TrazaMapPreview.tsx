import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Map as MapIcon } from 'lucide-react';
import { useEffect } from 'react';
import { env } from '../../lib/env.js';
import { type LatLng, boundsOf } from '../../lib/polyline.js';

/**
 * Mapa del recorrido real de un vehículo (capa 2, historial).
 *
 * Espejo de `EcoRouteMapPreview` pero para la traza REAL (puntos GPS ya
 * downsampleados por el backend), no una polyline encoded de Routes API:
 *   - Recibe `points: LatLng[]` directo (sin decode).
 *   - Traza en **azul** (`#2563EB`) para distinguirla visualmente de la ruta
 *     esperada verde de `EcoRouteMapPreview`.
 *   - Markers Inicio (I) / Fin (F) del recorrido.
 *   - Mismos fallbacks: sin API key o 0 puntos → placeholder minimal.
 */

export interface TrazaMapPreviewProps {
  /** Puntos de la traza real, orden temporal ascendente. */
  points: LatLng[];
  /** Alto del mapa en px. Default 320. */
  height?: number;
}

export function TrazaMapPreview({ points, height = 320 }: TrazaMapPreviewProps) {
  if (!env.VITE_GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-neutral-200 border-dashed bg-neutral-50 text-neutral-500 text-xs"
        style={{ height }}
        data-testid="traza-map-no-key"
      >
        <MapIcon className="mr-2 h-4 w-4" aria-hidden />
        Mapa del recorrido no disponible en este entorno.
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-neutral-200 border-dashed bg-neutral-50 text-neutral-500 text-xs"
        style={{ height }}
        data-testid="traza-map-empty"
      >
        <MapIcon className="mr-2 h-4 w-4" aria-hidden />
        Sin recorrido en el rango seleccionado.
      </div>
    );
  }

  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-md border border-neutral-200" data-testid="traza-map">
      <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          style={{ height, width: '100%' }}
          defaultCenter={start}
          defaultZoom={8}
          gestureHandling="cooperative"
          disableDefaultUI
          mapId="booster-traza-preview"
        >
          <TrazaPolyline points={points} />
          <AdvancedMarker position={start} title="Inicio">
            <Pin background="#2563EB" borderColor="#1E40AF" glyphColor="#FFFFFF">
              <span className="font-bold text-white">I</span>
            </Pin>
          </AdvancedMarker>
          <AdvancedMarker position={end} title="Fin">
            <Pin background="#D63031" borderColor="#9A1A1F" glyphColor="#FFFFFF">
              <span className="font-bold text-white">F</span>
            </Pin>
          </AdvancedMarker>
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

/**
 * Dibuja la traza real en el map instance. Mismo enfoque imperativo que
 * `RoutePolyline` de EcoRouteMapPreview (la lib no expone un wrapper de
 * `google.maps.Polyline`); limpia en el cleanup para no acumular líneas.
 */
function TrazaPolyline({ points }: { points: LatLng[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !mapsLib || !coreLib || points.length === 0) {
      return;
    }
    const polyline = new mapsLib.Polyline({
      path: points,
      strokeColor: '#2563EB',
      strokeOpacity: 0.95,
      strokeWeight: 4,
      geodesic: true,
    });
    polyline.setMap(map);

    const b = boundsOf(points);
    if (b) {
      const bounds = new coreLib.LatLngBounds(
        { lat: b.south, lng: b.west },
        { lat: b.north, lng: b.east },
      );
      map.fitBounds(bounds, 32);
    }

    return () => {
      polyline.setMap(null);
    };
  }, [map, mapsLib, coreLib, points]);

  return null;
}
