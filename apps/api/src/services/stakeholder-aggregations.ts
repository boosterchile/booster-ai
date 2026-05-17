import type { Logger } from '@booster-ai/logger';

/** Helpers puros para endpoints /stakeholder/zonas — D11/ADR-041. Timezone CL. */
const HORA_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Santiago',
  hour: 'numeric',
  hour12: false,
});

export interface ViajeAgregable {
  pickup_at: Date;
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
