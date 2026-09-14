import {
  type MetodoPrecision,
  type RouteDataSource,
  lineaMetodoCertificacion,
} from '@booster-ai/carbon-calculator';

/**
 * Línea de método (ADR-077 §4) a partir de una fila de `metricas_viaje`. Es el
 * único punto del API que la produce; la app la muestra tal cual, sin
 * reconstruir vocabulario. `null` cuando falta alguna de las tres dimensiones
 * (métricas legacy o viaje sin cierre): no se inventa método.
 */
export function lineaMetodoDesdeMetricas(m: {
  precisionMethod: MetodoPrecision | null;
  routeDataSource: RouteDataSource | null;
  coveragePct: string | number | null;
}): string | null {
  if (m.precisionMethod === null || m.routeDataSource === null || m.coveragePct === null) {
    return null;
  }
  const coveragePct = Number(m.coveragePct);
  if (!Number.isFinite(coveragePct)) {
    return null;
  }
  return lineaMetodoCertificacion({
    precisionMethod: m.precisionMethod,
    routeDataSource: m.routeDataSource,
    coveragePct,
  });
}
