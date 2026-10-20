import { describe, expect, it, vi } from 'vitest';
import { buscarSugerencias, detallarLugar, invertirCoordenadas } from './buscar-lugares.js';

describe('buscarSugerencias', () => {
  it('pide predicciones restringidas a Chile y devuelve el texto', async () => {
    const getPlacePredictions = vi.fn(
      (
        _request: unknown,
        callback: (predictions: Array<Record<string, unknown>> | null, status: string) => void,
      ) => {
        callback(
          [
            {
              place_id: 'p1',
              structured_formatting: {
                main_text: 'Compañía 4425',
                secondary_text: 'Santiago, Chile',
              },
            },
          ],
          'OK',
        );
      },
    );
    class AutocompleteService {
      getPlacePredictions = getPlacePredictions;
    }
    const sugerencias = await buscarSugerencias({ AutocompleteService }, 'Compañía');
    expect(sugerencias).toEqual([
      { placeId: 'p1', principal: 'Compañía 4425', secundario: 'Santiago, Chile' },
    ]);
    expect(getPlacePredictions).toHaveBeenCalledWith(
      expect.objectContaining({ componentRestrictions: { country: 'cl' }, language: 'es' }),
      expect.any(Function),
    );
  });

  it('null si Places responde REQUEST_DENIED', async () => {
    class AutocompleteService {
      getPlacePredictions(
        _request: unknown,
        callback: (predictions: null, status: string) => void,
      ): void {
        callback(null, 'REQUEST_DENIED');
      }
    }
    expect(await buscarSugerencias({ AutocompleteService }, 'Santiago')).toBeNull();
  });

  it('null si la librería no trae AutocompleteService', async () => {
    expect(await buscarSugerencias({}, 'Santiago')).toBeNull();
  });
});

describe('detallarLugar', () => {
  it('traduce la ficha de Places a región, comuna y coordenadas', async () => {
    class PlacesService {
      getDetails(
        _request: unknown,
        callback: (place: Record<string, unknown>, status: string) => void,
      ): void {
        callback(
          {
            formatted_address: 'Compañía 4425, Santiago, Chile',
            geometry: { location: { lat: () => -33.4391, lng: () => -70.6488 } },
            address_components: [
              {
                long_name: 'Santiago',
                short_name: 'Santiago',
                types: ['administrative_area_level_3', 'political'],
              },
              {
                long_name: 'Región Metropolitana de Santiago',
                short_name: 'RM',
                types: ['administrative_area_level_1', 'political'],
              },
            ],
          },
          'OK',
        );
      }
    }
    const lugar = await detallarLugar({ PlacesService }, 'p1', document.createElement('div'));
    expect(lugar).toEqual({
      direccion: 'Compañía 4425, Santiago',
      region: 'XIII',
      comunaCode: '13101',
      latitude: -33.4391,
      longitude: -70.6488,
    });
  });
});

describe('invertirCoordenadas', () => {
  it('rellena comuna y región desde el geocoder', async () => {
    class Geocoder {
      geocode(
        _request: unknown,
        callback: (results: Array<Record<string, unknown>>, status: string) => void,
      ): void {
        callback(
          [
            {
              formatted_address: 'Avenida Costanera 100, Concepción, Chile',
              geometry: { location: { lat: () => -36.827, lng: () => -73.0503 } },
              address_components: [
                {
                  long_name: 'Concepción',
                  short_name: 'Concepción',
                  types: ['locality', 'political'],
                },
                {
                  long_name: 'Región del Biobío',
                  short_name: 'Biobío',
                  types: ['administrative_area_level_1', 'political'],
                },
              ],
            },
          ],
          'OK',
        );
      }
    }
    const lugar = await invertirCoordenadas({ Geocoder }, -36.82, -73.05);
    expect(lugar?.region).toBe('VIII');
    expect(lugar?.comunaCode).toBe('08101');
    expect(lugar?.direccion).toBe('Avenida Costanera 100, Concepción');
  });

  it('null si el geocoder está denegado', async () => {
    class Geocoder {
      geocode(_request: unknown, callback: (results: null, status: string) => void): void {
        callback(null, 'REQUEST_DENIED');
      }
    }
    expect(await invertirCoordenadas({ Geocoder }, -33.4, -70.6)).toBeNull();
  });
});
