/**
 * Eval suite del prompt Gemini para coaching post-entrega (Phase 3 PR-J4).
 *
 * Permite regression testing del prompt sin re-pagar Gemini en CI:
 *   - hermetic via genFn stubbed (vitest)
 *   - live opcional (script `eval:live`) contra Gemini real si
 *     GEMINI_API_KEY está seteado.
 *
 * Public API mínima — exportamos solo lo que el caller necesita.
 */

export { CASOS_GOLDEN, type CasoGolden, type PropiedadEval } from './casos.js';
export { ejecutarEvals, formatearReporte, type ReporteEval, type ResultadoCaso } from './runner.js';
