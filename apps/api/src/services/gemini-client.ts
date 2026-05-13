import type { Logger } from '@booster-ai/logger';
import { GoogleAuth } from 'google-auth-library';

/**
 * Cliente HTTP de Gemini via Vertex AI (ADR-037, migración desde ADR-anterior
 * que usaba generativelanguage.googleapis.com con API key).
 *
 * Endpoint:
 *   POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/
 *        locations/{LOCATION}/publishers/google/models/{MODEL}:generateContent
 *
 * Autenticación: OAuth bearer token via ADC (Application Default Credentials).
 * En Cloud Run, ADC resuelve al Service Account del runtime (que tiene
 * roles/aiplatform.user). En local-dev, ADC viene de `gcloud auth
 * application-default login`.
 *
 * Cero API keys — la key Gemini productiva queda eliminada post-deploy
 * (ver ADR-037 sección "Apply post-merge"). Cierra el banner GCP "unrestricted
 * API keys for generativelanguage.googleapis.com".
 *
 * Errores: cualquier fallo (timeout, 4xx, 5xx, parse, auth) loggea WARN y
 * retorna null. coaching-generator interpreta null como señal de fallback
 * a plantilla.
 */

import type { GenerarTextoFn } from '@booster-ai/coaching-generator';

/** Timeout total del HTTP call (ms). Incluye latencia de obtener access token. */
const TIMEOUT_MS = 12_000;

/**
 * Modelo default. `gemini-2.5-flash` es la generación vigente (gemini-1.5
 * fue retirada por Google 2026-Q1). Override via opts si se necesita
 * gemini-2.5-pro u otro tier.
 */
const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Región Vertex AI. `southamerica-east1` (São Paulo) tiene latencia ~80ms
 * desde Santiago, vs ~150ms para us-central1. Modelo gemini-1.5-flash
 * disponible en saw1-east, confirmado en docs de Vertex AI (2026-Q2).
 */
const DEFAULT_LOCATION = 'southamerica-east1';

/**
 * Singleton de GoogleAuth — instanciar una vez por proceso evita el
 * overhead de descubrir credenciales en cada request. El cliente cachea
 * el access token internamente y lo renueva antes de expirar.
 */
const authClient = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export interface CreateGeminiGenFnOpts {
  /**
   * GCP project ID. En Cloud Run viene de GOOGLE_CLOUD_PROJECT env var.
   * Requerido para construir el endpoint Vertex AI.
   */
  projectId: string;
  /** Región Vertex AI. Default: southamerica-east1. */
  location?: string;
  /** Modelo Gemini. Default: gemini-1.5-flash (cheap, rápido). */
  model?: string;
  /** Inyectable para tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

/**
 * Crea una GenerarTextoFn que llama a Gemini via Vertex AI. El package
 * coaching-generator la consume sin saber del HTTP underlying.
 */
export function createGeminiGenFn(opts: CreateGeminiGenFnOpts): GenerarTextoFn {
  const {
    projectId,
    location = DEFAULT_LOCATION,
    model = DEFAULT_MODEL,
    fetchImpl = fetch,
    logger,
  } = opts;

  const endpoint =
    `https://${location}-aiplatform.googleapis.com/v1/` +
    `projects/${projectId}/locations/${location}/` +
    `publishers/google/models/${model}:generateContent`;

  return async ({ systemPrompt, userPrompt }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // ADC: en Cloud Run resuelve al SA del runtime (workload identity).
      // En local-dev, a las creds de `gcloud auth application-default login`.
      const client = await authClient.getClient();
      const tokenResponse = await client.getAccessToken();
      const accessToken = tokenResponse.token;

      if (!accessToken) {
        logger?.warn({ model }, 'ADC sin access token, fallback a plantilla');
        return null;
      }

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
          temperature: 0.2,
          maxOutputTokens: 200,
          topK: 40,
          topP: 0.95,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      };

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
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
            location,
          },
          'Vertex AI Gemini non-2xx, fallback a plantilla',
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
        logger?.warn({ model }, 'Vertex AI sin candidates, fallback a plantilla');
        return null;
      }

      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        logger?.warn(
          { finishReason: candidate.finishReason, model },
          'Vertex AI finish reason inesperado, fallback a plantilla',
        );
        return null;
      }

      const text = candidate.content?.parts?.[0]?.text?.trim();
      if (!text || text.length === 0) {
        logger?.warn({ model }, 'Vertex AI devolvió texto vacío, fallback a plantilla');
        return null;
      }

      return text;
    } catch (err) {
      logger?.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          model,
          location,
        },
        'Vertex AI Gemini fetch error, fallback a plantilla',
      );
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
