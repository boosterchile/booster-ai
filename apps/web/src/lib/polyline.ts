/**
 * Decoder de Google's Encoded Polyline Algorithm Format.
 *
 * Format docs: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * Pure function — sin dependencias externas, sin side effects. Permite
 * a la UI tomar el `polyline_encoded` que devuelve Routes API y
 * pintarlo en un componente de mapa (Google Maps JS) o cualquier otro
 * renderer de polylines.
 *
 * Algoritmo en plain English:
 *   1. Cada coordenada se codifica como un delta del valor anterior
 *      (las coordenadas absolutas se reconstruyen acumulando).
 *   2. Cada delta se multiplica por 1e5, se redondea, y se zig-zag
 *      encodea (positivo: `n*2`, negativo: `~(n*2)`).
 *   3. El resultado se chunkea en 5-bit groups, low-bit first.
 *   4. Cada group se ORrea con 0x20 si NO es el último de su valor.
 *   5. Cada group se suma con 63 ('?') para mapear a ASCII printables.
 *
 * Decode hace lo inverso. ~30 líneas, sin libs externas (`decode-polyline`
 * o `mapbox/polyline` agregarían deps que no necesitamos para un pure
 * algorithm).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Decodifica un string de polyline encoded a un array de coordenadas.
 *
 * Devuelve `[]` si el input es vacío. Nunca throwea — entradas malformadas
 * devuelven el prefijo válido decoded más lo que se haya recuperado.
 * Esto es deliberado: en producción Routes API devuelve polylines bien
 * formadas, y para la UI un decoded parcial es mejor que un crash.
 *
 * @param encoded String en Google Encoded Polyline Algorithm Format.
 * @returns Array de `{ lat, lng }` en grados decimales WGS84.
 */
export function decodePolyline(encoded: string): LatLng[] {
  if (!encoded || encoded.length === 0) {
    return [];
  }

  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode lat delta
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    // Decode lng delta
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Calcula la bounding box de un array de LatLng. Útil para que el mapa
 * haga `fitBounds` mostrando toda la ruta sin que el carrier tenga que
 * pan/zoom manualmente.
 *
 * Devuelve `null` si el array está vacío.
 */
export function boundsOf(points: LatLng[]): {
  north: number;
  south: number;
  east: number;
  west: number;
} | null {
  if (points.length === 0) {
    return null;
  }
  const first = points[0];
  if (!first) {
    return null;
  }
  let north = first.lat;
  let south = first.lat;
  let east = first.lng;
  let west = first.lng;
  for (const p of points) {
    if (p.lat > north) {
      north = p.lat;
    }
    if (p.lat < south) {
      south = p.lat;
    }
    if (p.lng > east) {
      east = p.lng;
    }
    if (p.lng < west) {
      west = p.lng;
    }
  }
  return { north, south, east, west };
}
