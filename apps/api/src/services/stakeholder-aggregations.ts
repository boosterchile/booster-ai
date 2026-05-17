import type { Logger } from '@booster-ai/logger';
import type { CargoType, FuelType, ZonaStakeholder } from '@booster-ai/shared-schemas';

/** Helpers puros para endpoints /stakeholder/zonas — D11/ADR-041. Timezone CL. */
const HORA_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Santiago',
  hour: 'numeric',
  hour12: false,
});

export interface ViajeAgregable {
  pickup_at: Date;
  tipo_carga: CargoType;
  fuel_type: FuelType;
  carbon_emissions_kgco2e_actual: number | null;
  carbon_emissions_kgco2e_estimated: number | null;
}
export interface BucketHora {
  hora: number;
  viajes: number;
  co2e_kg: number;
}
export interface HorarioPico {
  inicio: number;
  fin: number;
}
export interface BucketTipoCarga {
  tipo: CargoType;
  viajes: number;
  co2e_kg: number;
}
export interface BucketCombustible {
  fuel_type: FuelType;
  viajes: number;
  co2e_kg: number;
}

/** Hora 0..23 en America/Santiago para un timestamp UTC. */
export function horaEnChile(ts: Date): number {
  const part = HORA_FMT.formatToParts(ts).find((p) => p.type === 'hour');
  const h = part ? Number.parseInt(part.value, 10) : 0;
  return h === 24 ? 0 : h;
}

/** Spec criterio 7: actual → estimated → null+warn. */
export function resolveCo2e(viaje: ViajeAgregable, logger?: Logger): number | null {
  if (viaje.carbon_emissions_kgco2e_actual != null) {
    return viaje.carbon_emissions_kgco2e_actual;
  }
  if (viaje.carbon_emissions_kgco2e_estimated != null) {
    return viaje.carbon_emissions_kgco2e_estimated;
  }
  logger?.warn(
    { pickup_at: viaje.pickup_at.toISOString() },
    'stakeholder-aggregations: viaje sin CO2e; omitido del total',
  );
  return null;
}

/** 24 buckets CL — vacíos vienen con viajes:0, co2e_kg:0 (UI predecible). */
export function agregarPorHoraDelDia(
  viajes: readonly ViajeAgregable[],
  logger?: Logger,
): BucketHora[] {
  const buckets: BucketHora[] = Array.from({ length: 24 }, (_, hora) => ({
    hora,
    viajes: 0,
    co2e_kg: 0,
  }));
  for (const v of viajes) {
    const b = buckets[horaEnChile(v.pickup_at)];
    if (!b) {
      continue;
    }
    b.viajes += 1;
    const c = resolveCo2e(v, logger);
    if (c != null) {
      b.co2e_kg += c;
    }
  }
  return buckets;
}

/** Ventana 4h consecutivas con más pickups; null si <5 totales; empate → más temprana. */
export function calcularHorarioPico(viajes: readonly ViajeAgregable[]): HorarioPico | null {
  if (viajes.length < 5) {
    return null;
  }
  const c = new Array<number>(24).fill(0);
  for (const v of viajes) {
    const h = horaEnChile(v.pickup_at);
    c[h] = (c[h] ?? 0) + 1;
  }
  let inicio = 0;
  let total = -1;
  for (let i = 0; i <= 20; i += 1) {
    const t = (c[i] ?? 0) + (c[i + 1] ?? 0) + (c[i + 2] ?? 0) + (c[i + 3] ?? 0);
    if (t > total) {
      inicio = i;
      total = t;
    }
  }
  return { inicio, fin: inicio + 3 };
}

/** Helper genérico de agrupación: bucketea por una key callback y suma CO2e. */
function agruparPorClave<K extends string>(
  viajes: readonly ViajeAgregable[],
  key: (v: ViajeAgregable) => K,
  logger?: Logger,
): { clave: K; viajes: number; co2e_kg: number }[] {
  const acc = new Map<K, { viajes: number; co2e_kg: number }>();
  for (const v of viajes) {
    const k = key(v);
    const bucket = acc.get(k) ?? { viajes: 0, co2e_kg: 0 };
    bucket.viajes += 1;
    const c = resolveCo2e(v, logger);
    if (c != null) {
      bucket.co2e_kg += c;
    }
    acc.set(k, bucket);
  }
  return Array.from(acc.entries()).map(([clave, b]) => ({ clave, ...b }));
}

/** Bucketea por tipo de carga. Sólo aparecen tipos con ≥1 viaje. */
export function agregarPorTipoCarga(
  viajes: readonly ViajeAgregable[],
  logger?: Logger,
): BucketTipoCarga[] {
  return agruparPorClave(viajes, (v) => v.tipo_carga, logger).map((b) => ({
    tipo: b.clave,
    viajes: b.viajes,
    co2e_kg: b.co2e_kg,
  }));
}

/** Bucketea por combustible del vehículo. Sólo aparecen tipos con ≥1 viaje. */
export function agregarPorCombustible(
  viajes: readonly ViajeAgregable[],
  logger?: Logger,
): BucketCombustible[] {
  return agruparPorClave(viajes, (v) => v.fuel_type, logger).map((b) => ({
    fuel_type: b.clave,
    viajes: b.viajes,
    co2e_kg: b.co2e_kg,
  }));
}

/**
 * True si el punto cae dentro del bbox de la zona (inclusivo en todos los
 * bordes). Defensive: false si la zona tiene bbox invertido (la migration
 * lo previene con CHECK constraint pero el helper no asume).
 */
export function puntoEnBoundingBox(
  point: { lat: number; lng: number },
  zona: Pick<ZonaStakeholder, 'lat_min' | 'lat_max' | 'lng_min' | 'lng_max'>,
): boolean {
  if (zona.lat_min >= zona.lat_max || zona.lng_min >= zona.lng_max) {
    return false;
  }
  return (
    point.lat >= zona.lat_min &&
    point.lat <= zona.lat_max &&
    point.lng >= zona.lng_min &&
    point.lng <= zona.lng_max
  );
}
