import { type Presentacion, presentacionNivel } from '@booster-ai/certificate-generator';
import type { tripMetrics } from '../db/schema.js';

type Metricas = typeof tripMetrics.$inferSelect;

/**
 * Presentación de la huella (ADR-091) a partir de una fila de `metricas_viaje`.
 * Es el único punto del API que la calcula para la web
 * (`.specs/sello-huella-toda-la-web`); decide `presentacionNivel`, la misma
 * función que el PDF. Nivel, fuente o cobertura ausentes o fuera de regla dan
 * `estimado`.
 */
export function presentacionDesdeMetricas(m: {
  certificationLevel: Metricas['certificationLevel'];
  routeDataSource: Metricas['routeDataSource'];
  coveragePct: string | number | null;
}): Presentacion {
  const cobertura = m.coveragePct == null ? Number.NaN : Number(m.coveragePct);
  return presentacionNivel({
    ...(m.certificationLevel ? { certificationLevel: m.certificationLevel } : {}),
    ...(m.routeDataSource ? { routeDataSource: m.routeDataSource } : {}),
    ...(Number.isFinite(cobertura) ? { coveragePct: cobertura } : {}),
  }).presentacion;
}
