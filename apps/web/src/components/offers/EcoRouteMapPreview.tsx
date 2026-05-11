import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Map as MapIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { env } from '../../lib/env.js';
import { type LatLng, boundsOf, decodePolyline } from '../../lib/polyline.js';

/**
 * Eco-route map preview (Phase 1 PR-H4).
 *
 * Cierra el loop de la visión "Booster a través de IA sugiere la mejor
 * ruta para reducir huella de carbono": antes de PR-H4 el carrier solo
 * veía un número de emisiones (~250 kg CO₂e). Ahora ve TAMBIÉN la ruta
 * exacta sobre la que se calculó ese número, dibujada sobre Google Maps
 * con marker de origen (verde) y destino (rojo).
 *
 * **Diseño**:
 *   - Componente puro de presentación. Recibe el `polylineEncoded` ya
 *     resuelto por el caller (EcoPreviewBlock); decode local con la lib
 *     `polyline.ts` (zero deps, Google's algorithm).
 *   - Bounds calculados de los puntos decoded → `fitBounds` para que la
 *     ruta entera quepa sin pan manual.
 *   - Polyline real se dibuja via `google.maps.Polyline` directo (la
 *     lib `@vis.gl/react-google-maps` no expone un componente Polyline
 *     wrapping). El `useMap()` hook nos da el map instance.
 *   - Si `VITE_GOOGLE_MAPS_API_KEY` no está configurada o polyline
 *     decode-ea a 0 puntos → render fallback minimal sin Google Maps.
 *
 * **Por qué no hidratar SOLO con un static map URL**: porque el static
 * map de Google Maps API requiere passing el polyline encoded como query
 * param + cuesta dinero por request + no es interactivo. Con el map
 * instance ya costeado en VehicleMap (Phase 1+5), reusarlo aquí es
 * marginal — y el carrier puede zoom/pan para inspeccionar la ruta.
 */

export interface EcoRouteMapPreviewProps {
  /** Polyline encoded de Routes API (`EcoPreviewResponse.polyline_encoded`). */
  polylineEncoded: string;
  /** Alto del mapa en px. Default 200. */
  height?: number;
}

export function EcoRouteMapPreview({ polylineEncoded, height = 200 }: EcoRouteMapPreviewProps) {
  const points = useMemo<LatLng[]>(() => decodePolyline(polylineEncoded), [polylineEncoded]);

  if (!env.VITE_GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-neutral-200 border-dashed bg-neutral-50 text-neutral-500 text-xs"
        style={{ height }}
        data-testid="eco-route-map-no-key"
      >
        <MapIcon className="mr-2 h-4 w-4" aria-hidden />
        Mapa de la ruta no disponible en este entorno.
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-neutral-200 border-dashed bg-neutral-50 text-neutral-500 text-xs"
        style={{ height }}
        data-testid="eco-route-map-empty"
      >
        <MapIcon className="mr-2 h-4 w-4" aria-hidden />
        No se pudo decodificar la ruta sugerida.
      </div>
    );
  }

  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) {
    return null;
  }

  return (
    <div
      className="overflow-hidden rounded-md border border-success-700/20"
      data-testid="eco-route-map"
    >
      <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          style={{ height, width: '100%' }}
          defaultCenter={start}
          defaultZoom={8}
          gestureHandling="cooperative"
          disableDefaultUI
          mapId="booster-eco-route-preview"
        >
          <RoutePolyline points={points} />
          <AdvancedMarker position={start} title="Origen">
            <Pin background="#1FA058" borderColor="#0D6E3F" glyphColor="#FFFFFF">
              <span className="font-bold text-white">O</span>
            </Pin>
          </AdvancedMarker>
          <AdvancedMarker position={end} title="Destino">
            <Pin background="#D63031" borderColor="#9A1A1F" glyphColor="#FFFFFF">
              <span className="font-bold text-white">D</span>
            </Pin>
          </AdvancedMarker>
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

/**
 * Sub-componente que dibuja la polyline en el map instance.
 *
 * Por qué no es un componente "puro" de React: `@vis.gl/react-google-maps`
 * no expone un wrapper de `google.maps.Polyline`. Tenemos que tocar la
 * imperative API del map instance, gateada por el `useMap()` hook que
 * solo está disponible dentro del `APIProvider`. Limpiamos la polyline
 * en el effect cleanup para que un remount no acumule líneas duplicadas.
 */
function RoutePolyline({ points }: { points: LatLng[] }) {
  const map = useMap();
  // useMapsLibrary devuelve la lib `google.maps` ya cargada con tipos
  // correctos. Hasta que resuelve es `null` — evita race con APIProvider.
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib || points.length === 0) {
      return;
    }
    const polyline = new mapsLib.Polyline({
      path: points,
      strokeColor: '#1FA058',
      strokeOpacity: 0.95,
      strokeWeight: 4,
      geodesic: true,
    });
    polyline.setMap(map);

    // Fit bounds a la ruta. fitBounds tiene padding implicit pero le
    // damos un extra de margen para que los markers de origen/destino
    // no queden cortados al borde.
    const b = boundsOf(points);
    if (b) {
      const bounds = new mapsLib.LatLngBounds(
        { lat: b.south, lng: b.west },
        { lat: b.north, lng: b.east },
      );
      map.fitBounds(bounds, 32);
    }

    return () => {
      polyline.setMap(null);
    };
  }, [map, mapsLib, points]);

  return null;
}
