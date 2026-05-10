/**
 * @booster-ai/coaching-generator
 *
 * Generación de mensajes de coaching para transportistas a partir del
 * behavior score breakdown (consumido del @booster-ai/driver-scoring).
 *
 * Phase 3 (coaching IA) — feature original "comportamiento en ruta
 * para reducir huella de carbono". Combina:
 *
 *   1. Path AI: prompt curado + Gemini API via función `genFn`
 *      injectable. Modelo + tokens reportados para audit + cost.
 *   2. Path plantilla: fallback determinístico cuando Gemini falla
 *      o no está disponible. El carrier siempre recibe un mensaje útil.
 *
 * API pública:
 *
 *     import { generarCoachingConduccion } from '@booster-ai/coaching-generator';
 *
 *     const result = await generarCoachingConduccion(
 *       {
 *         score: 78,
 *         nivel: 'bueno',
 *         desglose: { ...counts },
 *         trip: { distanciaKm, duracionMinutos, tipoCarga },
 *       },
 *       {
 *         genFn: async ({ systemPrompt, userPrompt }) => {
 *           // implementación contra Gemini API o cualquier otro LLM
 *           return await callGemini({ systemPrompt, userPrompt });
 *         },
 *       },
 *     );
 *
 *     result.mensaje         // "5 frenados bruscos en este viaje. ..."
 *     result.focoPrincipal   // 'frenado'
 *     result.fuente          // 'gemini' | 'plantilla'
 */

export { generarCoachingConduccion } from './generar-coaching.js';
export { generarCoachingDeterministicoFromBreakdown } from './plantilla-fallback.js';
export { determinarFocoPrincipal } from './foco.js';
export { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
export type {
  ContextoTrip,
  DesgloseScore,
  FocoPrincipal,
  GenerarTextoFn,
  ParametrosCoaching,
  ResultadoCoaching,
} from './tipos.js';
export type { NivelScore } from './nivel-score-types.js';
