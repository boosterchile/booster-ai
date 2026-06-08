import { signupRequestSchema } from '@booster-ai/shared-schemas';
import type { z } from 'zod';
import { loadMarketingEnv } from './env.js';

/**
 * Body del `POST /api/v1/signup-request`, **derivado** del schema de dominio
 * compartido (`@booster-ai/shared-schemas`) — no espejado. Si el backend
 * cambia el shape del registro, este `.pick` cambia con él: es la red de
 * contrato más cercana sin tocar el backend (cuyo body schema NO es `.strict`,
 * ver follow-up). Se exporta para que el form (T5) lo use como resolver Zod.
 */
export const signupRequestBodySchema = signupRequestSchema.pick({
  email: true,
  nombreCompleto: true,
});

export type SignupRequestBody = z.infer<typeof signupRequestBodySchema>;

/**
 * Resultado de la solicitud, mapeado desde el status HTTP. `submitted` cubre
 * cualquier 202 — el backend responde idéntico para email nuevo vs existente
 * (anti-enumeration, ADR-052), así que NO leemos el body de respuesta.
 */
export type SignupOutcome =
  | 'submitted' // 202
  | 'invalid' // 422 (validación servidor)
  | 'rate_limited' // 429
  | 'unavailable' // 503 u otro status inesperado
  | 'network_error'; // fetch lanzó (red / bloqueo CORS) o api_url ausente

export interface SignupClientOptions {
  /** Override de la base del api (default: `loadMarketingEnv().apiUrl`). */
  apiUrl?: string;
  /** Override de `fetch` para test. */
  fetchImpl?: typeof fetch;
}

export async function postSignupRequest(
  input: SignupRequestBody,
  options: SignupClientOptions = {},
): Promise<SignupOutcome> {
  // Construcción explícita → el body tiene EXACTAMENTE las 2 claves, sin
  // posibilidad de arrastrar campos extra (defensa de shape del lado cliente).
  const body = { email: input.email, nombreCompleto: input.nombreCompleto };

  const apiUrl = options.apiUrl ?? loadMarketingEnv().apiUrl;
  if (!apiUrl) {
    return 'network_error';
  }

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(`${apiUrl}/api/v1/signup-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch rechaza ante fallo de red o bloqueo de CORS (incl. preflight).
    return 'network_error';
  }

  switch (res.status) {
    case 202:
      return 'submitted';
    case 422:
      return 'invalid';
    case 429:
      return 'rate_limited';
    default:
      return 'unavailable';
  }
}
