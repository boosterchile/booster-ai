import type { Logger } from '@booster-ai/logger';
import { aplicarKAnonymity } from '@booster-ai/shared-schemas';

/**
 * Helpers puros para endpoints /stakeholder/zonas — D11 / ADR-041 + ADR-042.
 *
 * Timezone: America/Santiago (display de hora en `por_hora_del_dia`).
 *
 * Naming alineado con db/schema.ts (per ADR-042 §4): `pickupWindowStart`,
 * `carbonEmissionsKgco2eActual`/`Estimated`. Camel case TS, snake_case SQL.
 */

const HORA_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Santiago',
  hour: 'numeric',
  hour12: false,
});

/** Forma minimal de un viaje que estos helpers consumen. */
export interface ViajeAgregable {
  pickupWindowStart: Date;
  carbonEmissionsKgco2eActual: number | null;
  carbonEmissionsKgco2eEstimated: number | null;
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

/**
 * k-anonymity threshold compartido para D11. Cambiar aquí, no en cada
 * call site, para garantizar consistencia (ADR-041 §2, ADR-042 §6).
 */
const K_ANON = 5;

/** Hora 0..23 en America/Santiago para un timestamp UTC. */
export function horaEnChile(ts: Date): number {
  const part = HORA_FMT.formatToParts(ts).find((p) => p.type === 'hour');
  const h = part ? Number.parseInt(part.value, 10) : 0;
  return h === 24 ? 0 : h;
}

/**
 * Spec criterio 7: prioriza CO2e actual; fallback a estimated; null+warn si ambos null.
 * Cuando retorna null, el viaje NO contribuye a co2e_kg pero SÍ cuenta en `viajes`
 * (decisión PO 2026-05-17 — ver review #251 comment).
 */
export function resolveCo2e(viaje: ViajeAgregable, logger?: Logger): number | null {
  if (viaje.carbonEmissionsKgco2eActual != null) {
    return viaje.carbonEmissionsKgco2eActual;
  }
  if (viaje.carbonEmissionsKgco2eEstimated != null) {
    return viaje.carbonEmissionsKgco2eEstimated;
  }
  logger?.warn(
    { pickupWindowStart: viaje.pickupWindowStart.toISOString() },
    'stakeholder-aggregations: viaje sin CO2e; omitido del total CO2e (cuenta en viajes)',
  );
  return null;
}

/**
 * 24 buckets CL. Buckets vacíos vienen con viajes:0/co2e_kg:0 (universo cerrado,
 * UI predecible). El caller debe aplicar k-anonymity por bucket usando
 * `aplicarKAnonymityHorario` antes de serializar.
 */
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
    const b = buckets[horaEnChile(v.pickupWindowStart)];
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

/**
 * Aplica k-anonymity per-bucket al output de `agregarPorHoraDelDia`.
 * Preserva `hora` (universo cerrado 0..23) y enmascara `viajes`/`co2e_kg`
 * cuando count < k (ADR-041 §2 + ADR-042 §6 nivel 2).
 *
 * Usar `dropSubKBuckets: false` (default del helper) porque las 24 horas
 * siempre se emiten — la presencia del bucket no leak, solo el valor.
 */
export type BucketHoraAnonimo = {
  hora: number;
  viajes: number | null;
  co2e_kg: number | null;
};

export function aplicarKAnonymityHorario(buckets: readonly BucketHora[]): BucketHoraAnonimo[] {
  return aplicarKAnonymity(
    buckets as readonly (BucketHora & Record<string, unknown>)[],
    K_ANON,
    'viajes',
    { preserveFields: ['hora'] },
  ) as BucketHoraAnonimo[];
}

/**
 * Ventana 4h consecutivas con más pickups dentro de [0..20]. Aplica k-anonymity
 * a NIVEL DATASET: si el total de viajes < k, retorna null. Plus: requiere que
 * la ventana ganadora tenga >= k viajes en agregado (evita la trampa de "5
 * viajes totales pero distribuidos uno-por-hora → ventana de 4h con 1-2 viajes").
 *
 * Empate → más temprana (estable). Si <5 viajes en TODA la ventana ganadora, null.
 */
export function calcularHorarioPico(viajes: readonly ViajeAgregable[]): HorarioPico | null {
  if (viajes.length < K_ANON) {
    return null;
  }
  const c = new Array<number>(24).fill(0);
  for (const v of viajes) {
    const h = horaEnChile(v.pickupWindowStart);
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
  // Defensa adicional: la ventana ganadora debe tener >= k viajes.
  // Si todos los viajes están distribuidos uno-por-hora, ninguna ventana
  // de 4h llega a k=5, así que el horario "pico" no es identificable.
  if (total < K_ANON) {
    return null;
  }
  return { inicio, fin: inicio + 3 };
}
