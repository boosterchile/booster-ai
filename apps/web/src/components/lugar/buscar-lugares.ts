import {
  type ComponenteDireccion,
  type RegionCode,
  interpretarComponentes,
} from '@booster-ai/shared-schemas';
import { logger } from '../../lib/logger.js';

/**
 * Adaptador mínimo de Places y Geocoding (librería JS que ya carga
 * `@vis.gl/react-google-maps`). Si la API no está habilitada en la key,
 * estas funciones devuelven null y el formulario sigue en texto libre.
 */

export interface SugerenciaLugar {
  placeId: string;
  principal: string;
  secundario: string;
}

export interface LugarDetallado {
  direccion: string;
  region: RegionCode | null;
  comunaCode: string | null;
  latitude: number;
  longitude: number;
}

interface PredictionMinima {
  place_id?: string;
  description?: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
}

interface AutocompleteServiceMinimo {
  getPlacePredictions(
    request: {
      input: string;
      componentRestrictions: { country: string };
      language: string;
    },
    callback: (predictions: PredictionMinima[] | null, status: string) => void,
  ): void;
}

interface ComponenteGoogle {
  long_name: string;
  short_name: string;
  types: string[];
}

interface LugarGoogle {
  formatted_address?: string;
  address_components?: ComponenteGoogle[];
  geometry?: { location?: { lat: () => number; lng: () => number } };
}

interface PlacesServiceMinimo {
  getDetails(
    request: { placeId: string; fields: string[]; language: string },
    callback: (place: LugarGoogle | null, status: string) => void,
  ): void;
}

interface GeocoderMinimo {
  geocode(
    request: { location: { lat: number; lng: number }; language: string; region: string },
    callback: (results: LugarGoogle[] | null, status: string) => void,
  ): void;
}

function ctorDe(libreria: object, nombre: string): (new () => object) | null {
  const descriptor = Object.getOwnPropertyDescriptor(libreria, nombre);
  const valor = descriptor?.value;
  if (typeof valor !== 'function') {
    return null;
  }
  return valor as new () => object;
}

function aComponentes(lista: ComponenteGoogle[] | undefined): ComponenteDireccion[] {
  return (lista ?? []).map((item) => ({
    longName: item.long_name,
    shortName: item.short_name,
    types: item.types,
  }));
}

function armarLugar(place: LugarGoogle | null): LugarDetallado | null {
  const lat = place?.geometry?.location?.lat();
  const lng = place?.geometry?.location?.lng();
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat === 0 || lng === 0) {
    return null;
  }
  const interpretado = interpretarComponentes(
    aComponentes(place?.address_components),
    place?.formatted_address ?? '',
  );
  const direccion =
    interpretado.direccion || `Punto en el mapa (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  return {
    direccion,
    region: interpretado.region,
    comunaCode: interpretado.comunaCode,
    latitude: lat,
    longitude: lng,
  };
}

/**
 * Sugerencias de direcciones en Chile. `null` = Places no respondió
 * (key sin la API, red, REQUEST_DENIED). Lista vacía = no hay coincidencias.
 */
export async function buscarSugerencias(
  places: object,
  input: string,
): Promise<SugerenciaLugar[] | null> {
  const Ctor = ctorDe(places, 'AutocompleteService');
  if (!Ctor) {
    return null;
  }
  const servicio = new Ctor() as AutocompleteServiceMinimo;
  try {
    const predictions = await new Promise<PredictionMinima[] | null>((resolve, reject) => {
      servicio.getPlacePredictions(
        { input, componentRestrictions: { country: 'cl' }, language: 'es' },
        (lista, status) => {
          if (status === 'OK' || status === 'ZERO_RESULTS') {
            resolve(lista);
            return;
          }
          reject(new Error(status));
        },
      );
    });
    const sugerencias: SugerenciaLugar[] = [];
    for (const item of predictions ?? []) {
      if (!item.place_id) {
        continue;
      }
      sugerencias.push({
        placeId: item.place_id,
        principal: item.structured_formatting?.main_text ?? item.description ?? item.place_id,
        secundario: item.structured_formatting?.secondary_text ?? '',
      });
    }
    return sugerencias;
  } catch (err) {
    logger.warn({ err }, 'places autocomplete no disponible');
    return null;
  }
}

/** Detalle de una sugerencia: dirección, región, comuna y lat/lng. */
export async function detallarLugar(
  places: object,
  placeId: string,
  ancla: HTMLElement,
): Promise<LugarDetallado | null> {
  const Ctor = ctorDe(places, 'PlacesService');
  if (!Ctor) {
    return null;
  }
  const servicio = new (Ctor as new (attrContainer: HTMLElement) => PlacesServiceMinimo)(ancla);
  try {
    const place = await new Promise<LugarGoogle | null>((resolve, reject) => {
      servicio.getDetails(
        {
          placeId,
          fields: ['formatted_address', 'geometry', 'address_components'],
          language: 'es',
        },
        (resultado, status) => {
          if (status === 'OK') {
            resolve(resultado);
            return;
          }
          reject(new Error(status));
        },
      );
    });
    return armarLugar(place);
  } catch (err) {
    logger.warn({ err }, 'places getDetails no disponible');
    return null;
  }
}

/** Geocoding inverso de un pin o de un link ya resuelto a coordenadas. */
export async function invertirCoordenadas(
  geocoding: object,
  latitude: number,
  longitude: number,
): Promise<LugarDetallado | null> {
  const Ctor = ctorDe(geocoding, 'Geocoder');
  if (!Ctor) {
    return null;
  }
  const geocoder = new Ctor() as GeocoderMinimo;
  try {
    const results = await new Promise<LugarGoogle[] | null>((resolve, reject) => {
      geocoder.geocode(
        { location: { lat: latitude, lng: longitude }, language: 'es', region: 'cl' },
        (lista, status) => {
          if (status === 'OK' || status === 'ZERO_RESULTS') {
            resolve(lista);
            return;
          }
          reject(new Error(status));
        },
      );
    });
    return armarLugar(results?.[0] ?? null);
  } catch (err) {
    logger.warn({ err }, 'geocoding inverso no disponible');
    return null;
  }
}
