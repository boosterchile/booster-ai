/**
 * Espejo del NivelScore de @booster-ai/driver-scoring. Duplicado para
 * mantener este package zero-dep (no depende de driver-scoring; ambos
 * son consumidos juntos por apps/api). Si los niveles cambian en
 * driver-scoring, actualizar acá también.
 */
export type NivelScore = 'excelente' | 'bueno' | 'regular' | 'malo';
