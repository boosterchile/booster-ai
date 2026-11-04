import { type LatLng, decodePolyline } from './polyline.js';

/**
 * Eco-routing en tiempo real (T10-23) del lado de la PWA: helpers puros para
 * navegar por la alternativa y para resolver el clic en la notificación.
 */

/**
 * Enlace de Google Maps que fuerza la ruta alternativa: Maps no acepta una
 * polilínea, así que se pasa su punto medio como waypoint (basta para que
 * elija ese corredor) y el destino real del viaje.
 */
export function hrefNavegacionAlternativa(
  polylineAlternativa: string,
  destinoCoords: LatLng | null,
  destinoDireccion: string,
): string {
  const params = new URLSearchParams({
    api: '1',
    destination: destinoCoords ? `${destinoCoords.lat},${destinoCoords.lng}` : destinoDireccion,
    travelmode: 'driving',
    dir_action: 'navigate',
  });
  const puntos = decodePolyline(polylineAlternativa);
  const medio = puntos[Math.floor(puntos.length / 2)];
  if (puntos.length >= 3 && medio) {
    params.set('waypoints', `${medio.lat},${medio.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export interface DataNotificacionSugerencia {
  tipo: 'sugerencia_ruta';
  assignment_id: string;
  sugerencia_id: string;
  url: string;
}

export interface DataNotificacionChat {
  assignment_id: string;
  message_id: string;
  url: string;
}

/**
 * URL a abrir al tocar una notificación. En una sugerencia de ruta, las
 * acciones Aceptar / Seguir agregan `respuesta=` y la PWA la registra al
 * abrir (el service worker no tiene la sesión para llamar al api).
 */
export function urlClickNotificacion(
  data: DataNotificacionSugerencia | DataNotificacionChat | undefined,
  accion: string,
): string | null {
  if (!data?.url) {
    return null;
  }
  if (!('tipo' in data) || data.tipo !== 'sugerencia_ruta') {
    return data.url;
  }
  const respuesta = accion === 'aceptar' ? 'aceptada' : accion === 'seguir' ? 'rechazada' : null;
  if (!respuesta) {
    return data.url;
  }
  return `${data.url}${data.url.includes('?') ? '&' : '?'}respuesta=${respuesta}`;
}

/** Lee `?sugerencia=&respuesta=` que deja el clic en una acción de la notificación. */
export function respuestaDesdeUrl(
  search: string,
): { sugerenciaId: string; respuesta: 'aceptada' | 'rechazada' } | null {
  const params = new URLSearchParams(search);
  const sugerenciaId = params.get('sugerencia');
  const respuesta = params.get('respuesta');
  if (!sugerenciaId || (respuesta !== 'aceptada' && respuesta !== 'rechazada')) {
    return null;
  }
  return { sugerenciaId, respuesta };
}
