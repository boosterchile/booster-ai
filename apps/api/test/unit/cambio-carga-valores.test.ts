import { describe, expect, it } from 'vitest';
import {
  type ViajeEditable,
  cambiaComercial,
  cambiaHuella,
  camposQueCambian,
  columnasDesdeCambios,
  normalizarPropuesta,
  soloCampos,
  valoresActuales,
} from '../../src/services/cambio-carga-valores.js';

const VIAJE: ViajeEditable = {
  originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
  originRegionCode: 'XIII',
  originComunaCode: '13114',
  originLatitude: '-33.4100000',
  originLongitude: '-70.5800000',
  destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
  destinationRegionCode: 'V',
  destinationComunaCode: null,
  destinationLatitude: null,
  destinationLongitude: null,
  cargoType: 'carga_seca',
  cargoWeightKg: 1000,
  cargoVolumeM3: null,
  cargoDescription: null,
  pickupWindowStart: new Date('2026-11-20T12:00:00Z'),
  pickupWindowEnd: new Date('2026-11-20T15:00:00Z'),
  proposedPriceClp: 800_000,
  modalidadCarga: 'spot',
};

describe('valoresActuales', () => {
  it('proyecta la carga a la forma pública, con coordenadas numéricas e ISO normalizado', () => {
    expect(valoresActuales(VIAJE)).toEqual({
      origin: {
        address_raw: 'Av. Apoquindo 4500, Las Condes',
        region_code: 'XIII',
        comuna_code: '13114',
        latitude: -33.41,
        longitude: -70.58,
      },
      destination: {
        address_raw: 'Av. Libertad 100, Viña del Mar',
        region_code: 'V',
        comuna_code: null,
        latitude: null,
        longitude: null,
      },
      cargo_type: 'carga_seca',
      weight_kg: 1000,
      volume_m3: null,
      description: null,
      pickup_window: {
        start_at: '2026-11-20T12:00:00.000Z',
        end_at: '2026-11-20T15:00:00.000Z',
      },
      proposed_price_clp: 800_000,
      modalidad_carga: 'spot',
    });
  });

  it('sin ventana guardada, pickup_window es null', () => {
    expect(
      valoresActuales({ ...VIAJE, pickupWindowStart: null, pickupWindowEnd: null }).pickup_window,
    ).toBeNull();
  });
});

describe('camposQueCambian', () => {
  const actuales = valoresActuales(VIAJE);

  it('ignora lo que se propone igual al valor actual (también la misma ventana en otro formato)', () => {
    const propuesta = normalizarPropuesta({
      weight_kg: 1000,
      pickup_window: { start_at: '2026-11-20T12:00:00Z', end_at: '2026-11-20T15:00:00.000Z' },
    });
    expect(camposQueCambian(actuales, propuesta)).toEqual([]);
  });

  it('devuelve los campos distintos en el orden canónico', () => {
    const propuesta = normalizarPropuesta({
      weight_kg: 2000,
      origin: { address_raw: 'Camino Lo Boza 120, Pudahuel', region_code: 'XIII' },
    });
    expect(camposQueCambian(actuales, propuesta)).toEqual(['origin', 'weight_kg']);
  });

  it('el mismo origen sin coordenadas cuenta como cambio (las coordenadas se pierden)', () => {
    const propuesta = normalizarPropuesta({
      origin: {
        address_raw: 'Av. Apoquindo 4500, Las Condes',
        region_code: 'XIII',
        comuna_code: '13114',
      },
    });
    expect(camposQueCambian(actuales, propuesta)).toEqual(['origin']);
  });
});

describe('precisión de coordenadas', () => {
  it('el mismo punto con más de 7 decimales no cuenta como cambio (numeric(10,7))', () => {
    const propuesta = normalizarPropuesta({
      origin: {
        address_raw: 'Av. Apoquindo 4500, Las Condes',
        region_code: 'XIII',
        comuna_code: '13114',
        latitude: -33.410000004,
        longitude: -70.580000049,
      },
    });
    expect(camposQueCambian(valoresActuales(VIAJE), propuesta)).toEqual([]);
    expect(propuesta.origin).toMatchObject({ latitude: -33.41, longitude: -70.58 });
  });
});

describe('soloCampos', () => {
  it('se queda con los campos pedidos', () => {
    expect(soloCampos(valoresActuales(VIAJE), ['weight_kg', 'volume_m3'])).toEqual({
      weight_kg: 1000,
      volume_m3: null,
    });
  });
});

describe('columnasDesdeCambios', () => {
  it('origen sin coordenadas deja lat/lng en null y la ventana reescribe el texto raw', () => {
    const set = columnasDesdeCambios(
      normalizarPropuesta({
        origin: { address_raw: 'Camino Lo Boza 120, Pudahuel', region_code: 'XIII' },
        pickup_window: { start_at: '2026-11-21T12:00:00Z', end_at: '2026-11-21T14:00:00Z' },
        description: null,
      }),
    );
    expect(set).toMatchObject({
      originAddressRaw: 'Camino Lo Boza 120, Pudahuel',
      originRegionCode: 'XIII',
      originComunaCode: null,
      originLatitude: null,
      originLongitude: null,
      cargoDescription: null,
      pickupDateRaw: '2026-11-21T12:00:00.000Z → 2026-11-21T14:00:00.000Z',
    });
    expect(set.pickupWindowStart).toEqual(new Date('2026-11-21T12:00:00Z'));
    expect(set).not.toHaveProperty('destinationAddressRaw');
  });

  it('coordenadas a numeric(10,7) como string', () => {
    const set = columnasDesdeCambios(
      normalizarPropuesta({
        destination: {
          address_raw: 'Puerto de San Antonio',
          region_code: 'V',
          latitude: -33.5935,
          longitude: -71.6127,
        },
      }),
    );
    expect(set).toMatchObject({
      destinationLatitude: '-33.5935000',
      destinationLongitude: '-71.6127000',
    });
  });
});

describe('cambiaHuella', () => {
  it('origen, destino, tipo y peso cambian la huella; ventana y descripción no', () => {
    expect(cambiaHuella(['weight_kg'])).toBe(true);
    expect(cambiaHuella(['destination'])).toBe(true);
    expect(cambiaHuella(['pickup_window', 'description', 'volume_m3'])).toBe(false);
  });
});

describe('campos comerciales (editar-anular-cargas §7)', () => {
  it('precio y modalidad se comparan y se escriben en viajes', () => {
    const propuesta = normalizarPropuesta({ proposed_price_clp: 900_000, modalidad_carga: 'spot' });
    expect(camposQueCambian(valoresActuales(VIAJE), propuesta)).toEqual(['proposed_price_clp']);
    expect(
      columnasDesdeCambios(
        normalizarPropuesta({ proposed_price_clp: 900_000, modalidad_carga: 'programada' }),
      ),
    ).toEqual({ proposedPriceClp: 900_000, modalidadCarga: 'programada' });
  });

  it('cambiaComercial distingue precio y modalidad del resto', () => {
    expect(cambiaComercial(['weight_kg', 'modalidad_carga'])).toBe(true);
    expect(cambiaComercial(['weight_kg'])).toBe(false);
  });
});
