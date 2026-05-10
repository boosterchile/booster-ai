import type { Logger } from '@booster-ai/logger';

/**
 * Cliente HTTP del Gemini API (Phase 3 PR-J2).
 *
 * Usamos la REST API directamente en vez del SDK @google/generative-ai
 * por:
 *   - Cero deps adicionales (apps/api ya tiene fetch nativo).
 *   - Control fino del timeout (~10s) — el SDK no lo expone fácilmente.
 *   - Test pattern consistente con routes-api.ts (fetch mockeable).
 *
 * Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   ?key=API_KEY
 *
 * Diseño: este módulo expone una factoría que crea un `GenerarTextoFn`
 * compatible con la interfaz de @booster-ai/coaching-generator. El
 * caller (generar-coaching-viaje.ts) inyecta el resultado al package.
 *
 * Errores: cualquier fallo (timeout, 4xx, 5xx, parse error) loggea WARN
 * y retorna `null`. El package coaching-generator interpreta null como
 * señal de "fallback a plantilla", que es el comportamiento deseado.
 */

import type { GenerarTextoFn } from '@booster-ai/coaching-generator';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Timeout total del HTTP call (ms). Si Gemini tarda más, fallback. */
const TIMEOUT_MS = 10_000;

/** Modelo default. Override via opts del crear cliente. */
const DEFAULT_MODEL = 'gemini-1.5-flash';

export interface CreateGeminiGenFnOpts {
  apiKey: string;
  /** Modelo Gemini. Default: gemini-1.5-flash (cheap, rápido). */
  model?: string;
  /**
   * Inyectable para tests. Default: global fetch.
   */
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

/**
 * Crea una `GenerarTextoFn` que llama a Gemini API. El package
 * coaching-generator la consume sin saber del HTTP underlying.
 */
export function createGeminiGenFn(opts: CreateGeminiGenFnOpts): GenerarTextoFn {
  const { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, logger } = opts;

  return async ({ systemPrompt, userPrompt }) => {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        // Temperature 0.2 para casi-determinismo manteniendo variedad
        // mínima en wording (0 estricto a veces da output muy seco).
        temperature: 0.2,
        maxOutputTokens: 200, // ~280 chars target + slack
        topK: 40,
        topP: 0.95,
      },
      // Safety: bloquear solo high-severity. Coaching tiene tono
      // neutral; no necesitamos bloqueo médico/sexual paranoico.
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        logger?.warn(
          {
            httpStatus: response.status,
            errBody: errBody.slice(0, 300),
            model,
          },
          'Gemini API non-2xx, fallback a plantilla',
        );
        return null;
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
      };

      const candidate = json.candidates?.[0];
      if (!candidate) {
        logger?.warn({ model }, 'Gemini API sin candidates, fallback a plantilla');
        return null;
      }

      // finishReason ≠ 'STOP' indica que Gemini fue truncado o bloqueado
      // por safety. En esos casos no usamos el output parcial.
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        logger?.warn(
          { finishReason: candidate.finishReason, model },
          'Gemini API finish reason inesperado, fallback a plantilla',
        );
        return null;
      }

      const text = candidate.content?.parts?.[0]?.text?.trim();
      if (!text || text.length === 0) {
        logger?.warn({ model }, 'Gemini API devolvió texto vacío, fallback a plantilla');
        return null;
      }

      return text;
    } catch (err) {
      logger?.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          model,
        },
        'Gemini API fetch error, fallback a plantilla',
      );
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
