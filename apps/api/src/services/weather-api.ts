import type { Logger } from '@booster-ai/logger';
import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';

/**
 * Cliente del Google Weather API (Maps Platform) — "current conditions".
 *
 * Endpoint: GET https://weather.googleapis.com/v1/currentConditions:lookup
 * Docs: https://developers.google.com/maps/documentation/weather
 *
 * Diseño (espejo de `routes-api.ts`, ADR-038):
 *   - Autenticación OAuth bearer via ADC (Application Default Credentials).
 *     En Cloud Run resuelve al SA del runtime; cero API keys nuevas.
 *   - `X-Goog-User-Project` obligatorio (a quién se factura la cuota).
 *   - `fetch` y token inyectables (para tests, sin ADC real).
 *   - Timeout duro (AbortController) para no colgar el slot de Cloud Run.
 *   - Boundary Zod sobre la respuesta (regla de stack).
 *
 * ToS: la condición actual solo se cachea ≤ 1h y no se persiste — el caché
 * vive en `clima-ambiente-cache.ts` (Map efímero). Este cliente solo llama.
 *
 * ⚠️ La API `weather.googleapis.com` debe estar HABILITADA en el proyecto
 * (acción de Felipe): `gcloud services enable weather.googleapis.com`.
 */

const authClient = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/** Timeout duro de la llamada HTTP (hot path del live view — más corto que Routes). */
export const WEATHER_API_TIMEOUT_MS = 5_000;

const WEATHER_API_URL = 'https://weather.googleapis.com/v1/currentConditions:lookup';

export class WeatherApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_request'
      | 'invalid_response'
      | 'auth_error'
      | 'quota_exceeded'
      | 'network_error'
      | 'timeout'
      | 'unknown',
    public readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = 'WeatherApiError';
  }
}

/** Boundary: solo necesitamos la temperatura en grados. */
const currentConditionsSchema = z.object({
  temperature: z.object({
    degrees: z.number(),
    unit: z.string().optional(),
  }),
});

export interface ClimaActualParams {
  lat: number;
  lng: number;
  /** GCP project ID facturado (header X-Goog-User-Project). */
  projectId: string;
  fetchImpl?: typeof fetch;
  /** Getter del token ADC (inyectable para tests). Default: ADC real. */
  getAccessToken?: () => Promise<string | null>;
  logger?: Logger;
  timeoutMs?: number;
}

/** Token ADC real (Cloud Run: SA del runtime; local: `gcloud auth application-default`). */
async function adcToken(): Promise<string | null> {
  const client = await authClient.getClient();
  const { token } = await client.getAccessToken();
  return token ?? null;
}

/**
 * Llama al Weather API y devuelve la temperatura ambiente en °C.
 * @throws WeatherApiError en fallo de auth/red/timeout/HTTP/parseo.
 */
export async function obtenerClimaActual(params: ClimaActualParams): Promise<number> {
  const {
    lat,
    lng,
    projectId,
    fetchImpl = fetch,
    getAccessToken = adcToken,
    logger,
    timeoutMs = WEATHER_API_TIMEOUT_MS,
  } = params;

  let accessToken: string | null;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    throw new WeatherApiError(
      `ADC token error: ${err instanceof Error ? err.message : 'unknown'}`,
      'auth_error',
      null,
    );
  }
  if (!accessToken) {
    throw new WeatherApiError('ADC returned no access token for Weather API', 'auth_error', null);
  }

  // unitsSystem=METRIC → grados Celsius.
  const url = `${WEATHER_API_URL}?location.latitude=${lat}&location.longitude=${lng}&unitsSystem=METRIC`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-User-Project': projectId,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger?.warn({ lat, lng, timeoutMs }, 'Weather API timeout');
      throw new WeatherApiError(`Weather API timed out after ${timeoutMs}ms`, 'timeout', null);
    }
    throw new WeatherApiError(
      `Network error calling Weather API: ${err instanceof Error ? err.message : 'unknown'}`,
      'network_error',
      null,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errBody = '';
    try {
      errBody = await response.text();
    } catch {
      errBody = '';
    }
    const code = mapHttpStatusToCode(response.status);
    logger?.warn(
      { httpStatus: response.status, code, errBody: errBody.slice(0, 200) },
      'Weather API non-2xx',
    );
    throw new WeatherApiError(
      `Weather API returned ${response.status}: ${errBody.slice(0, 200)}`,
      code,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = currentConditionsSchema.safeParse(json);
  if (!parsed.success) {
    throw new WeatherApiError(
      'Weather API response missing temperature.degrees',
      'invalid_response',
      null,
    );
  }
  return parsed.data.temperature.degrees;
}

function mapHttpStatusToCode(status: number): WeatherApiError['code'] {
  if (status === 400) {
    return 'invalid_request';
  }
  if (status === 401 || status === 403) {
    return 'auth_error';
  }
  if (status === 429) {
    return 'quota_exceeded';
  }
  return 'unknown';
}
