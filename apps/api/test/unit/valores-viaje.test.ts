import type { TripRequestCreateInput } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import { valoresViajeDesdeInput } from '../../src/services/valores-viaje.js';

const BASE: TripRequestCreateInput = {
  origin: { address_raw: 'Av. Apoquindo 4500, Las Condes', region_code: 'XIII' },
  destination: {
    address_raw: 'Av. Libertad 100, Viña del Mar',
    region_code: 'V',
    comuna_code: '05109',
    latitude: -33.0245,
    longitude: -71.5518,
  },
  cargo: { cargo_type: 'carga_seca', weight_kg: 1000 },
  pickup_window: { start_at: '2026-11-20T12:00:00.000Z', end_at: '2026-11-20T15:00:00.000Z' },
  proposed_price_clp: null,
  modalidad_carga: 'spot',
};

describe('valoresViajeDesdeInput (editar-anular-cargas §6.1)', () => {
  it('mapea el formulario a columnas, con null explícito en los opcionales ausentes', () => {
    expect(valoresViajeDesdeInput(BASE)).toEqual({
      originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
      originRegionCode: 'XIII',
      originComunaCode: null,
      originLatitude: null,
      originLongitude: null,
      destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
      destinationRegionCode: 'V',
      destinationComunaCode: '05109',
      destinationLatitude: '-33.0245000',
      destinationLongitude: '-71.5518000',
      cargoType: 'carga_seca',
      cargoWeightKg: 1000,
      cargoVolumeM3: null,
      cargoDescription: null,
      pickupDateRaw: '2026-11-20T12:00:00.000Z → 2026-11-20T15:00:00.000Z',
      pickupWindowStart: new Date('2026-11-20T12:00:00.000Z'),
      pickupWindowEnd: new Date('2026-11-20T15:00:00.000Z'),
      proposedPriceClp: null,
      consigneeName: null,
      consigneeEmail: null,
      consigneeWhatsappE164: null,
      notes: null,
      reference: null,
      modalidadCarga: 'spot',
    });
  });

  it('copia destinatario, notas, referencia, volumen y precio cuando vienen', () => {
    const v = valoresViajeDesdeInput({
      ...BASE,
      cargo: { cargo_type: 'refrigerada', weight_kg: 500, volume_m3: 12, description: 'Frutas' },
      proposed_price_clp: 450_000,
      consignee: { name: 'Bodega', phone_e164: '+56911111111', email: 'b@empresa.cl' },
      notes: 'Andén 4',
      reference: 'PO-1',
    });
    expect(v).toMatchObject({
      cargoType: 'refrigerada',
      cargoVolumeM3: 12,
      cargoDescription: 'Frutas',
      proposedPriceClp: 450_000,
      consigneeName: 'Bodega',
      consigneeWhatsappE164: '+56911111111',
      consigneeEmail: 'b@empresa.cl',
      notes: 'Andén 4',
      reference: 'PO-1',
    });
  });
});
