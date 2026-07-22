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
 * Mapa del recorrido real de un vehículo/carga (capa 2, historial).
 *
 * Dibuja la traza REAL (puntos GPS ya downsampleados por el backend) en
 * **azul**, y opcionalmente la ruta ESPERADA (`expectedRoute`, polyline de
 * Routes API ya decodeada) en **verde** — colores distintos, como pide el
 * goal por-carga. Markers Inicio (I) / Fin (F) sobre la traza real.
 *
 * Espejo de `EcoRouteMapPreview` (misma lib, mismo enfoque imperativo para la
 * polyline). Reusa `boundsOf` para encuadrar ambas líneas. Fallbacks: sin API
 * key, o sin traza NI ruta esperada → placeholder minimal.
 */

export interface TrazaMapPreviewProps {
  /** Puntos de la traza real, orden temporal ascendente. */
  points: LatLng[];
  /** Ruta esperada ya decodeada (opcional, se dibuja en verde). */
  expectedRoute?: LatLng[];
  /** Alto del mapa en px. Default 320. */
  height?: number;
}

export function TrazaMapPreview({
  points,
  expectedRoute = [],
  height = 320,
}: TrazaMapPreviewProps) {
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

  const hasReal = points.length > 0;
  const center = points[0] ?? expectedRoute[0];
  if (!center) {
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

  const start = hasReal ? points[0] : undefined;
  const end = hasReal ? points[points.length - 1] : undefined;

  return (
    <div className="overflow-hidden rounded-md border border-neutral-200" data-testid="traza-map">
      <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          style={{ height, width: '100%' }}
          defaultCenter={center}
          defaultZoom={8}
          gestureHandling="cooperative"
          disableDefaultUI
          mapId="booster-traza-preview"
        >
          <TrazaLineas real={points} esperada={expectedRoute} />
          {start ? (
            <AdvancedMarker position={start} title="Inicio">
              <Pin background="#2563EB" borderColor="#1E40AF" glyphColor="#FFFFFF">
                <span className="font-bold text-white">I</span>
              </Pin>
            </AdvancedMarker>
          ) : null}
          {end ? (
            <AdvancedMarker position={end} title="Fin">
              <Pin background="#D63031" borderColor="#9A1A1F" glyphColor="#FFFFFF">
                <span className="font-bold text-white">F</span>
              </Pin>
            </AdvancedMarker>
          ) : null}
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

/**
 * Dibuja la ruta esperada (verde) y la traza real (azul) en el map instance.
 * Mismo enfoque imperativo que `RoutePolyline` de EcoRouteMapPreview (la lib no
 * expone un wrapper de `google.maps.Polyline`); limpia ambas en el cleanup.
 */
function TrazaLineas({ real, esperada }: { real: LatLng[]; esperada: LatLng[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !mapsLib || !coreLib) {
      return;
    }
    const lineaEsperada =
      esperada.length > 0
        ? new mapsLib.Polyline({
            path: esperada,
            strokeColor: '#1FA058',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            geodesic: true,
          })
        : null;
    lineaEsperada?.setMap(map);

    const lineaReal =
      real.length > 0
        ? new mapsLib.Polyline({
            path: real,
            strokeColor: '#2563EB',
            strokeOpacity: 0.95,
            strokeWeight: 4,
            geodesic: true,
          })
        : null;
    lineaReal?.setMap(map);

    const b = boundsOf([...esperada, ...real]);
    if (b) {
      const bounds = new coreLib.LatLngBounds(
        { lat: b.south, lng: b.west },
        { lat: b.north, lng: b.east },
      );
      map.fitBounds(bounds, 32);
    }

    return () => {
      lineaEsperada?.setMap(null);
      lineaReal?.setMap(null);
    };
  }, [map, mapsLib, coreLib, real, esperada]);

  return null;
}
