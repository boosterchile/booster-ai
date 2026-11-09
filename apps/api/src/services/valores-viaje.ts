import type { TripRequestCreateInput } from '@booster-ai/shared-schemas';
import type { trips } from '../db/schema.js';

/**
 * Columnas de `viajes` que salen del formulario de la carga (creación y
 * edición antes del match, editar-anular-cargas §6.1). Devuelve todos los
 * campos editables, con `null` explícito en los opcionales ausentes: al
 * editar, borrar un dato opcional tiene que borrarlo en la BD.
 */

type ViajeInsert = typeof trips.$inferInsert;

export type ValoresViaje = Required<
  Pick<
    ViajeInsert,
    | 'originAddressRaw'
    | 'originRegionCode'
    | 'originComunaCode'
    | 'originLatitude'
    | 'originLongitude'
    | 'destinationAddressRaw'
    | 'destinationRegionCode'
    | 'destinationComunaCode'
    | 'destinationLatitude'
    | 'destinationLongitude'
    | 'cargoType'
    | 'cargoWeightKg'
    | 'cargoVolumeM3'
    | 'cargoDescription'
    | 'pickupDateRaw'
    | 'pickupWindowStart'
    | 'pickupWindowEnd'
    | 'proposedPriceClp'
    | 'consigneeName'
    | 'consigneeEmail'
    | 'consigneeWhatsappE164'
    | 'notes'
    | 'reference'
    | 'modalidadCarga'
  >
>;

/** numeric(10,7) como string, el modo en que Drizzle persiste el tipo. */
function coordenada(v: number | undefined): string | null {
  return v === undefined ? null : v.toFixed(7);
}

export function valoresViajeDesdeInput(input: TripRequestCreateInput): ValoresViaje {
  const conPunto = (l: { latitude?: number | undefined; longitude?: number | undefined }) =>
    l.latitude !== undefined && l.longitude !== undefined;
  return {
    originAddressRaw: input.origin.address_raw,
    originRegionCode: input.origin.region_code,
    originComunaCode: input.origin.comuna_code ?? null,
    originLatitude: conPunto(input.origin) ? coordenada(input.origin.latitude) : null,
    originLongitude: conPunto(input.origin) ? coordenada(input.origin.longitude) : null,
    destinationAddressRaw: input.destination.address_raw,
    destinationRegionCode: input.destination.region_code,
    destinationComunaCode: input.destination.comuna_code ?? null,
    destinationLatitude: conPunto(input.destination)
      ? coordenada(input.destination.latitude)
      : null,
    destinationLongitude: conPunto(input.destination)
      ? coordenada(input.destination.longitude)
      : null,
    cargoType: input.cargo.cargo_type,
    cargoWeightKg: input.cargo.weight_kg,
    cargoVolumeM3: input.cargo.volume_m3 ?? null,
    cargoDescription: input.cargo.description ? input.cargo.description : null,
    pickupDateRaw: `${input.pickup_window.start_at} → ${input.pickup_window.end_at}`,
    pickupWindowStart: new Date(input.pickup_window.start_at),
    pickupWindowEnd: new Date(input.pickup_window.end_at),
    proposedPriceClp: input.proposed_price_clp,
    // Phase 5 PR-L3b — datos del destinatario opt-in para el link de tracking.
    consigneeName: input.consignee?.name ?? null,
    consigneeEmail: input.consignee?.email ?? null,
    consigneeWhatsappE164: input.consignee?.phone_e164 ?? null,
    // editar-anular-cargas §12-P4: notas y referencia opcionales.
    notes: input.notes ?? null,
    reference: input.reference ?? null,
    modalidadCarga: input.modalidad_carga,
  };
}
