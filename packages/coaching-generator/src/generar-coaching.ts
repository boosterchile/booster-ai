import { determinarFocoPrincipal } from './foco.js';
import { generarCoachingDeterministicoFromBreakdown } from './plantilla-fallback.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import type { GenerarTextoFn, ParametrosCoaching, ResultadoCoaching } from './tipos.js';

/**
 * Genera un mensaje de coaching para el transportista a partir del
 * score breakdown del trip (Phase 3 PR-J1).
 *
 * Estrategia:
 *
 *   1. Si `genFn` está presente, llamamos al modelo (Gemini típicamente).
 *      Si responde con un string no-vacío y dentro del budget de chars,
 *      lo usamos. Modelo + tokens se reportan en el resultado para
 *      audit + cost tracking.
 *
 *   2. Si `genFn` falla (throw o devuelve null/empty), o si genFn no
 *      fue provisto, caemos a la plantilla determinística. El carrier
 *      recibe SIEMPRE un mensaje útil — la fuente AI vs plantilla es
 *      transparente para él, pero el campo `fuente` permite distinguir
 *      en analytics.
 *
 * Función con I/O **delegado** al `genFn` injectable. Los tests
 * proveen mocks; producción inyecta el wrapper de Gemini.
 *
 * Determinismo:
 *   - Plantilla: 100% determinística (mismo input → mismo output).
 *   - Gemini: con temperature=0 en el caller, ~95% determinístico
 *     (variación marginal por re-tokenization).
 */

/** Hard limit del mensaje. Override del SDK no genera más. */
const MAX_CHARS = 320; // 280 target + slack para que no rechacemos por 1-2 chars

export interface GenerarCoachingOpts {
  /**
   * Función injectable que llama al modelo. Si null/undefined,
   * skip directo a plantilla.
   */
  genFn?: GenerarTextoFn | null;
  /**
   * Nombre del modelo (para reportar en `resultado.modelo` cuando
   * fuente='gemini'). Default: 'gemini-2.0-flash-exp'.
   */
  modelo?: string;
}

export async function generarCoachingConduccion(
  params: ParametrosCoaching,
  opts: GenerarCoachingOpts = {},
): Promise<ResultadoCoaching> {
  const { genFn, modelo = 'gemini-2.0-flash-exp' } = opts;

  // Path 1: AI con genFn injectable.
  if (genFn) {
    try {
      const text = await genFn({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(params),
      });

      if (text && text.trim().length > 0 && text.length <= MAX_CHARS) {
        return {
          mensaje: text.trim(),
          focoPrincipal: determinarFocoPrincipal(params.desglose),
          fuente: 'gemini',
          modelo,
        };
      }
      // Salida vacía o demasiado larga → caer a plantilla. Loggear
      // en el caller (este package no tiene logger inyectado).
    } catch {
      // Cualquier error del genFn → fallback silencioso. El caller
      // ve una respuesta válida; quien quiera observabilidad usa
      // un genFn que loggee internamente.
    }
  }

  // Path 2: plantilla determinística.
  return generarCoachingDeterministicoFromBreakdown(params);
}
