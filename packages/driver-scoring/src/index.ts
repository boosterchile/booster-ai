/**
 * @booster-ai/driver-scoring
 *
 * Cálculo del score de conducción por viaje, basado en eventos
 * green-driving + over-speeding capturados por Teltonika FMC150
 * (codec8-parser IO 253/254/255).
 *
 * Phase 2 (driver behavior scoring) — feature original "comportamiento
 * en ruta para reducir huella de carbono".
 *
 * API pública:
 *
 *     import { calcularScoreConduccion } from '@booster-ai/driver-scoring';
 *
 *     const result = calcularScoreConduccion({
 *       events: [
 *         { type: 'frenado_brusco', severity: 1900, timestampMs: 1_777_000_000_000 },
 *         { type: 'exceso_velocidad', severity: 110, timestampMs: 1_777_000_300_000 },
 *       ],
 *       tripDurationMinutes: 90,
 *     });
 *
 *     result.score                          // 93
 *     result.nivel                          // 'excelente'
 *     result.desglose.frenadosBruscos       // 1
 *     result.desglose.excesosVelocidad      // 1
 *     result.desglose.penalizacionTotal     // 7 (5 + 2)
 *     result.desglose.eventosPorHora        // 1.33
 *
 * Función PURA: sin I/O, determinística. Si el caller (apps/api o
 * dashboard) quiere persistir el resultado, lo hace fuera.
 */

export { calcularScoreConduccion } from './calcular-score.js';
export type {
  EventoConduccion,
  NivelScore,
  ParametrosScore,
  ResultadoScore,
  TipoEvento,
} from './tipos.js';
