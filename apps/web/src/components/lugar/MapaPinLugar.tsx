import {
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { useEffect, useRef } from 'react';
import { logger } from '../../lib/logger.js';
import { type LugarDetallado, invertirCoordenadas } from './buscar-lugares.js';

const SANTIAGO = { lat: -33.4489, lng: -70.6693 };

interface MapaPinLugarProps {
  latitude: number | null;
  longitude: number | null;
  /** Sube cuando el usuario mueve el pin, toca el mapa o pega un punto. */
  revision: number;
  onMover: (latitude: number, longitude: number) => void;
  onLugar: (lugar: LugarDetallado) => void;
  onGeocodeFallo: () => void;
}

function numeroDe(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return valor;
  }
  if (typeof valor === 'function') {
    const resultado: unknown = valor();
    if (typeof resultado === 'number' && Number.isFinite(resultado)) {
      return resultado;
    }
  }
  return null;
}

function leerPar(valor: unknown): { lat: number; lng: number } | null {
  if (typeof valor !== 'object' || valor === null || !('lat' in valor) || !('lng' in valor)) {
    return null;
  }
  const lat = numeroDe(valor.lat);
  const lng = numeroDe(valor.lng);
  if (lat === null || lng === null) {
    return null;
  }
  return { lat, lng };
}

/**
 * Recentra cuando llega un punto nuevo (paste o sugerencia). No sigue cada
 * pan del usuario: solo reacciona a `revision`.
 */
function SeguirPin({
  latitude,
  longitude,
  revision,
}: {
  latitude: number | null;
  longitude: number | null;
  revision: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || latitude === null || longitude === null || revision === 0) {
      return;
    }
    map.panTo({ lat: latitude, lng: longitude });
    const zoom = map.getZoom();
    if (zoom === undefined || zoom < 15) {
      map.setZoom(16);
    }
  }, [map, latitude, longitude, revision]);
  return null;
}

function GeocodificarPin({
  latitude,
  longitude,
  revision,
  onLugar,
  onGeocodeFallo,
}: Omit<MapaPinLugarProps, 'onMover'>) {
  const geocoding = useMapsLibrary('geocoding');
  const onLugarRef = useRef(onLugar);
  const onFalloRef = useRef(onGeocodeFallo);
  onLugarRef.current = onLugar;
  onFalloRef.current = onGeocodeFallo;
  useEffect(() => {
    if (!geocoding || latitude === null || longitude === null || revision === 0) {
      return;
    }
    let vigente = true;
    void invertirCoordenadas(geocoding, latitude, longitude).then((lugar) => {
      if (!vigente) {
        return;
      }
      if (!lugar) {
        logger.warn({ revision }, 'geocoding inverso sin resultado');
        onFalloRef.current();
        return;
      }
      onLugarRef.current(lugar);
    });
    return () => {
      vigente = false;
    };
  }, [geocoding, latitude, longitude, revision]);
  return null;
}

/**
 * Mapa con pin arrastrable. Tocar el mapa o soltar el pin mueve el punto.
 * El geocoding inverso corre en el padre de datos vía `revision`.
 */
export function MapaPinLugar({
  latitude,
  longitude,
  revision,
  onMover,
  onLugar,
  onGeocodeFallo,
}: MapaPinLugarProps) {
  const centro =
    latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : SANTIAGO;

  return (
    <div
      className="h-60 overflow-hidden rounded-md border border-neutral-200 sm:h-72"
      data-testid="mapa-pin"
    >
      <GoogleMap
        style={{ width: '100%', height: '100%' }}
        defaultCenter={centro}
        defaultZoom={latitude !== null ? 16 : 11}
        gestureHandling="greedy"
        fullscreenControl={false}
        streetViewControl={false}
        mapTypeControl={false}
        mapId="booster-lugar-pin"
        onClick={(event) => {
          const punto = leerPar(event.detail.latLng);
          if (punto) {
            onMover(punto.lat, punto.lng);
          }
        }}
      >
        <SeguirPin latitude={latitude} longitude={longitude} revision={revision} />
        <GeocodificarPin
          latitude={latitude}
          longitude={longitude}
          revision={revision}
          onLugar={onLugar}
          onGeocodeFallo={onGeocodeFallo}
        />
        {latitude !== null && longitude !== null && (
          <AdvancedMarker
            position={{ lat: latitude, lng: longitude }}
            draggable
            title="Arrastrá el pin o tocá el mapa"
            onDragEnd={(event) => {
              const punto = leerPar(event.latLng);
              if (punto) {
                onMover(punto.lat, punto.lng);
              }
            }}
          >
            <Pin background="#1FA058" borderColor="#0D6E3F" glyphColor="#FFFFFF" />
          </AdvancedMarker>
        )}
      </GoogleMap>
    </div>
  );
}
