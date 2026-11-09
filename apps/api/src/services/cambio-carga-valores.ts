import {
  CAMPOS_PROPONIBLES,
  type CambioPropuesto,
  type CambiosGuardados,
  type CampoPropuesto,
} from '@booster-ai/shared-schemas';
import type { trips } from '../db/schema.js';

/**
 * Proyección entre una carga (`viajes`) y la forma pública de sus campos
 * editables con aceptación (editar-anular-cargas §5). Funciones puras: las usa
 * el servicio de solicitudes para guardar `valores_anteriores`, detectar si
 * algo cambió y escribir lo aceptado.
 */

type ViajeRow = typeof trips.$inferSelect;

/** Los campos de `viajes` que esta proyección lee. */
export type ViajeEditable = Pick<
  ViajeRow,
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
  | 'pickupWindowStart'
  | 'pickupWindowEnd'
  | 'proposedPriceClp'
  | 'modalidadCarga'
>;

type Lugar = NonNullable<CambiosGuardados['origin']>;

function numeroONull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ISO en UTC con milisegundos: el mismo instante siempre se escribe igual. */
function isoNormalizado(v: Date | string): string {
  return new Date(v).toISOString();
}

function lugar(
  address: string,
  region: string | null,
  comuna: string | null,
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): Lugar {
  return {
    address_raw: address,
    region_code: region,
    comuna_code: comuna,
    latitude: numeroONull(lat),
    longitude: numeroONull(lng),
  };
}

/** Valor actual de cada campo proponible, en la forma de `cambiosGuardadosSchema`. */
export function valoresActuales(v: ViajeEditable): Required<CambiosGuardados> {
  return {
    origin: lugar(
      v.originAddressRaw,
      v.originRegionCode,
      v.originComunaCode,
      v.originLatitude,
      v.originLongitude,
    ),
    destination: lugar(
      v.destinationAddressRaw,
      v.destinationRegionCode,
      v.destinationComunaCode,
      v.destinationLatitude,
      v.destinationLongitude,
    ),
    cargo_type: v.cargoType,
    weight_kg: v.cargoWeightKg,
    volume_m3: v.cargoVolumeM3,
    description: v.cargoDescription,
    pickup_window:
      v.pickupWindowStart && v.pickupWindowEnd
        ? {
            start_at: isoNormalizado(v.pickupWindowStart),
            end_at: isoNormalizado(v.pickupWindowEnd),
          }
        : null,
    proposed_price_clp: v.proposedPriceClp,
    modalidad_carga: v.modalidadCarga,
  };
}

/** Siete decimales, la precisión de `numeric(10,7)`: el mismo punto compara igual. */
function redondear7(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Number(v.toFixed(7));
}

/** La propuesta validada, en la misma forma normalizada que `valoresActuales`. */
export function normalizarPropuesta(c: CambioPropuesto): CambiosGuardados {
  const out: CambiosGuardados = {};
  if (c.origin) {
    out.origin = lugar(
      c.origin.address_raw,
      c.origin.region_code,
      c.origin.comuna_code ?? null,
      redondear7(c.origin.latitude),
      redondear7(c.origin.longitude),
    );
  }
  if (c.destination) {
    out.destination = lugar(
      c.destination.address_raw,
      c.destination.region_code,
      c.destination.comuna_code ?? null,
      redondear7(c.destination.latitude),
      redondear7(c.destination.longitude),
    );
  }
  if (c.cargo_type !== undefined) {
    out.cargo_type = c.cargo_type;
  }
  if (c.weight_kg !== undefined) {
    out.weight_kg = c.weight_kg;
  }
  if (c.volume_m3 !== undefined) {
    out.volume_m3 = c.volume_m3;
  }
  if (c.description !== undefined) {
    out.description = c.description === '' ? null : c.description;
  }
  if (c.pickup_window) {
    out.pickup_window = {
      start_at: isoNormalizado(c.pickup_window.start_at),
      end_at: isoNormalizado(c.pickup_window.end_at),
    };
  }
  if (c.proposed_price_clp !== undefined) {
    out.proposed_price_clp = c.proposed_price_clp;
  }
  if (c.modalidad_carga !== undefined) {
    out.modalidad_carga = c.modalidad_carga;
  }
  return out;
}

/** Igualdad por valor, independiente del orden de las claves. */
function mismoValor(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) =>
      mismoValor((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

/** Campos de la propuesta que difieren del valor actual, en el orden canónico. */
export function camposQueCambian(
  actuales: CambiosGuardados,
  propuesta: CambiosGuardados,
): CampoPropuesto[] {
  return CAMPOS_PROPONIBLES.filter(
    (campo) => propuesta[campo] !== undefined && !mismoValor(actuales[campo], propuesta[campo]),
  );
}

/** Solo los campos indicados, tomados de `valores`. */
export function soloCampos(
  valores: CambiosGuardados,
  campos: readonly CampoPropuesto[],
): CambiosGuardados {
  return Object.fromEntries(
    Object.entries(valores).filter(([campo]) => (campos as readonly string[]).includes(campo)),
  );
}

function coordenada(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toFixed(7);
}

/** Columnas de `viajes` a escribir al aceptar `cambios`. */
export function columnasDesdeCambios(cambios: CambiosGuardados): Partial<ViajeRow> {
  const set: Partial<ViajeRow> = {};
  if (cambios.origin) {
    set.originAddressRaw = cambios.origin.address_raw;
    set.originRegionCode = cambios.origin.region_code;
    set.originComunaCode = cambios.origin.comuna_code ?? null;
    // Sin coordenadas nuevas, las viejas apuntarían al origen anterior.
    set.originLatitude = coordenada(cambios.origin.latitude);
    set.originLongitude = coordenada(cambios.origin.longitude);
  }
  if (cambios.destination) {
    set.destinationAddressRaw = cambios.destination.address_raw;
    set.destinationRegionCode = cambios.destination.region_code;
    set.destinationComunaCode = cambios.destination.comuna_code ?? null;
    set.destinationLatitude = coordenada(cambios.destination.latitude);
    set.destinationLongitude = coordenada(cambios.destination.longitude);
  }
  if (cambios.cargo_type !== undefined) {
    set.cargoType = cambios.cargo_type;
  }
  if (cambios.weight_kg !== undefined) {
    set.cargoWeightKg = cambios.weight_kg;
  }
  if (cambios.volume_m3 !== undefined) {
    set.cargoVolumeM3 = cambios.volume_m3;
  }
  if (cambios.description !== undefined) {
    set.cargoDescription = cambios.description;
  }
  if (cambios.pickup_window) {
    set.pickupWindowStart = new Date(cambios.pickup_window.start_at);
    set.pickupWindowEnd = new Date(cambios.pickup_window.end_at);
    set.pickupDateRaw = `${cambios.pickup_window.start_at} → ${cambios.pickup_window.end_at}`;
  }
  if (cambios.proposed_price_clp !== undefined) {
    set.proposedPriceClp = cambios.proposed_price_clp;
  }
  if (cambios.modalidad_carga !== undefined) {
    set.modalidadCarga = cambios.modalidad_carga;
  }
  return set;
}

/** Cambió algo que afecta la huella estimada (distancia, tipo o peso). */
const CAMPOS_HUELLA: ReadonlySet<CampoPropuesto> = new Set([
  'origin',
  'destination',
  'cargo_type',
  'weight_kg',
]);

export function cambiaHuella(campos: readonly CampoPropuesto[]): boolean {
  return campos.some((c) => CAMPOS_HUELLA.has(c));
}

const CAMPOS_COMERCIALES_PROPUESTOS: ReadonlySet<CampoPropuesto> = new Set([
  'proposed_price_clp',
  'modalidad_carga',
]);

/** Cambió precio o modalidad: recalcula precio acordado y comisión (§7). */
export function cambiaComercial(campos: readonly CampoPropuesto[]): boolean {
  return campos.some((c) => CAMPOS_COMERCIALES_PROPUESTOS.has(c));
}
