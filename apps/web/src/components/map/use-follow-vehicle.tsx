import { useMap } from '@vis.gl/react-google-maps';
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Follow mode para mapas que muestran un vehículo en movimiento.
 *
 *   - Por defecto, el mapa se re-centra en el vehículo cada vez que llega
 *     telemetría nueva (panTo suave; el zoom NO se toca).
 *   - Si el usuario arrastra o hace zoom manualmente, se pausa el follow:
 *     puede explorar libremente sin que el siguiente poll deshaga su
 *     interacción.
 *   - El botón "Recentrar" reactiva el follow y trae la cámara al vehículo
 *     (sin tocar el zoom).
 *
 * Uso:
 *
 *   const follow = useFollowVehicle();
 *
 *   <Map defaultCenter={...} defaultZoom={...}>
 *     <FollowVehicle controller={follow} latitude={lat} longitude={lng} />
 *     <AdvancedMarker ... />
 *   </Map>
 *   {!follow.following && <RecenterButton onClick={follow.resume} />}
 */

export interface FollowController {
  /** Si el mapa está siguiendo al vehículo (true) o pausado por interacción
   *  manual del usuario (false). Usar para condicionar la UI del botón
   *  "Recentrar". */
  readonly following: boolean;
  /** Reactiva el follow y recentra el mapa al vehículo (y restablece el
   *  zoom default si se pasó como prop a `<FollowVehicle>`). */
  readonly resume: () => void;
  /** @internal Consumido por `<FollowVehicle>` para reflejar interacciones
   *  del usuario en el estado de follow. No invocar desde código consumidor. */
  setFollowing: (v: boolean) => void;
  /** @internal Consumido por `<FollowVehicle>` para mantener el callback de
   *  recentrado siempre sincronizado con las coords actuales. No leer/escribir
   *  desde código consumidor. */
  resumeRef: MutableRefObject<() => void>;
}

export function useFollowVehicle(): FollowController {
  const [following, setFollowing] = useState(true);
  const resumeRef = useRef<() => void>(() => {
    // Placeholder; reemplazado por <FollowVehicle> en su useEffect.
  });

  const resume = useCallback(() => {
    setFollowing(true);
    resumeRef.current();
  }, []);

  return { following, resume, setFollowing, resumeRef };
}

export function FollowVehicle({
  controller,
  latitude,
  longitude,
  zoom,
}: {
  controller: FollowController;
  latitude: number;
  longitude: number;
  /** Zoom default al que vuelve la cámara cuando el usuario hace clic en
   *  "Recentrar". Si se omite, recentrar solo hace pan y respeta el zoom
   *  actual del usuario. */
  zoom?: number | undefined;
}) {
  const map = useMap();
  const { following, setFollowing, resumeRef } = controller;
  const initialZoomApplied = useRef(false);
  const ignoreNextZoom = useRef(false);

  // Mantener resumeRef apuntando a un panTo+setZoom con los valores más
  // recientes. El setZoom puede dispararse solo si realmente va a cambiar
  // el zoom; si ya estamos en el zoom default, evitamos un zoom_changed
  // innecesario.
  useEffect(() => {
    if (!map) {
      return;
    }
    resumeRef.current = () => {
      map.panTo({ lat: latitude, lng: longitude });
      if (zoom != null && map.getZoom() !== zoom) {
        // Ignorar el próximo zoom_changed (el que dispara este setZoom)
        // para que el listener no interprete un cambio programático como
        // interacción del usuario y vuelva a pausar el follow.
        ignoreNextZoom.current = true;
        map.setZoom(zoom);
      }
    };
  }, [map, latitude, longitude, zoom, resumeRef]);

  // Auto-pan cuando llega telemetría nueva y follow está activo.
  useEffect(() => {
    if (!map || !following) {
      return;
    }
    map.panTo({ lat: latitude, lng: longitude });
  }, [map, following, latitude, longitude]);

  // Pausar follow cuando el usuario interactúa con el mapa.
  // El primer `zoom_changed` lo dispara la lib al aplicar `defaultZoom` en
  // el montaje; lo ignoramos para no entrar pausado de entrada.
  useEffect(() => {
    if (!map) {
      return;
    }
    const pause = () => setFollowing(false);
    const onZoom = () => {
      if (!initialZoomApplied.current) {
        initialZoomApplied.current = true;
        return;
      }
      if (ignoreNextZoom.current) {
        ignoreNextZoom.current = false;
        return;
      }
      pause();
    };
    const dragListener = map.addListener('dragstart', pause);
    const zoomListener = map.addListener('zoom_changed', onZoom);
    return () => {
      dragListener.remove();
      zoomListener.remove();
    };
  }, [map, setFollowing]);

  return null;
}
