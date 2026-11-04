import { describe, expect, it } from 'vitest';
import { hrefNavegacionAlternativa, urlClickNotificacion } from './eco-routing.js';

// Polilínea de ejemplo de Google: (38.5,-120.2) → (40.7,-120.95) → (43.252,-126.453)
const POLY = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

describe('hrefNavegacionAlternativa', () => {
  it('fuerza la alternativa con su punto medio como waypoint hacia el destino', () => {
    const href = hrefNavegacionAlternativa(POLY, { lat: -33.02, lng: -71.55 }, 'Viña del Mar');
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('-33.02,-71.55');
    expect(url.searchParams.get('waypoints')).toBe('40.7,-120.95');
    expect(url.searchParams.get('travelmode')).toBe('driving');
    expect(url.searchParams.get('dir_action')).toBe('navigate');
  });

  it('sin coordenadas de destino usa la dirección; sin polilínea útil no agrega waypoint', () => {
    const url = new URL(hrefNavegacionAlternativa('', null, 'Av. Libertad 100, Viña del Mar'));
    expect(url.searchParams.get('destination')).toBe('Av. Libertad 100, Viña del Mar');
    expect(url.searchParams.has('waypoints')).toBe(false);
  });
});

describe('urlClickNotificacion', () => {
  const data = {
    tipo: 'sugerencia_ruta' as const,
    assignment_id: 'a-1',
    sugerencia_id: 's-1',
    url: '/app/conductor?sugerencia=s-1',
  };

  it('acción aceptar / seguir agrega la respuesta a la URL', () => {
    expect(urlClickNotificacion(data, 'aceptar')).toBe(
      '/app/conductor?sugerencia=s-1&respuesta=aceptada',
    );
    expect(urlClickNotificacion(data, 'seguir')).toBe(
      '/app/conductor?sugerencia=s-1&respuesta=rechazada',
    );
  });

  it('clic en el cuerpo (sin acción) abre la URL tal cual', () => {
    expect(urlClickNotificacion(data, '')).toBe('/app/conductor?sugerencia=s-1');
  });

  it('notificaciones de chat: la URL no cambia aunque llegue una acción', () => {
    expect(
      urlClickNotificacion({ assignment_id: 'a', message_id: 'm', url: '/chat/a' }, 'aceptar'),
    ).toBe('/chat/a');
  });

  it('sin data o sin url → null', () => {
    expect(urlClickNotificacion(undefined, '')).toBeNull();
  });
});

describe('respuestaDesdeUrl', () => {
  it('lee sugerencia y respuesta válidas', async () => {
    const { respuestaDesdeUrl } = await import('./eco-routing.js');
    expect(respuestaDesdeUrl('?sugerencia=s-1&respuesta=aceptada')).toEqual({
      sugerenciaId: 's-1',
      respuesta: 'aceptada',
    });
    expect(respuestaDesdeUrl('?sugerencia=s-1&respuesta=rechazada')).toEqual({
      sugerenciaId: 's-1',
      respuesta: 'rechazada',
    });
    expect(respuestaDesdeUrl('?sugerencia=s-1')).toBeNull();
    expect(respuestaDesdeUrl('?respuesta=aceptada')).toBeNull();
    expect(respuestaDesdeUrl('?sugerencia=s-1&respuesta=quizas')).toBeNull();
  });

  it('URL sin query agrega ? al responder', async () => {
    const { urlClickNotificacion } = await import('./eco-routing.js');
    expect(
      urlClickNotificacion(
        { tipo: 'sugerencia_ruta', assignment_id: 'a', sugerencia_id: 's', url: '/app/conductor' },
        'seguir',
      ),
    ).toBe('/app/conductor?respuesta=rechazada');
  });
});
