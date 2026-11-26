import { type MedicionHuella, medicionHuella } from '@booster-ai/carbon-calculator';
import type { tripMetrics } from '../db/schema.js';

type Metricas = typeof tripMetrics.$inferSelect;

/**
 * Lo medido y el nivel con lo que le falta (`.specs/frente2-cierre` §3.1) a
 * partir de una fila de `metricas_viaje` y el peso declarado de la carga. Es
 * el único punto del API que lo arma; la web lo muestra tal cual.
 */
export function medicionDesdeMetricas(
  m: {
    precisionMethod: Metricas['precisionMethod'];
    routeDataSource: Metricas['routeDataSource'];
    coveragePct: string | number | null;
    certificationLevel: Metricas['certificationLevel'];
  },
  pesoDeclaradoKg: number | null,
): MedicionHuella {
  const cobertura = m.coveragePct == null ? null : Number(m.coveragePct);
  return medicionHuella({
    precisionMethod: m.precisionMethod,
    routeDataSource: m.routeDataSource,
    coveragePct: cobertura != null && Number.isFinite(cobertura) ? cobertura : null,
    certificationLevel: m.certificationLevel,
    pesoDeclaradoKg,
  });
}
