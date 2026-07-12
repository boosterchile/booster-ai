import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api-client.js';
import { humanizeRotarClaveError } from './use-rotar-clave.js';

/**
 * Tests de `humanizeRotarClaveError` — la copy honesta bajo impersonación.
 *
 * Contexto (bug del trío que atrapa al admin): bajo impersonación, el
 * `impersonation-write-guard` del backend responde 403
 * `forbidden_impersonation_write` al `POST /me/clave-numerica` (fail-closed,
 * correcto). La copy vieja mapeaba CUALQUIER 403 → "La clave anterior no es
 * correcta." vía el proxy `err.status === 403`, mintiendo sobre la causa.
 *
 * Forma REAL del wire (verificado, NO se toca el backend):
 *   - `me-clave-numerica.ts` → `{ error: 'invalid_clave_anterior' }` (SIN
 *     campo `code`). En api-client eso deja `err.code = undefined` y
 *     `err.message = 'invalid_clave_anterior'` (de `payload.error`).
 *   - `impersonation-write-guard.ts` → `{ error, code:
 *     'forbidden_impersonation_write' }` → `err.code =
 *     'forbidden_impersonation_write'`.
 * Por eso el distingo fiel es por el IDENTIFICADOR del error (code o message),
 * nunca por `status === 403`.
 */

const CLAVE_MSG = 'La clave anterior no es correcta.';

/** Construye el ApiError tal como lo produce api-client para un body dado. */
function apiErrorFromBody(status: number, body: { error?: string; code?: string }): ApiError {
  const code = typeof body.code === 'string' ? body.code : undefined;
  const message = typeof body.error === 'string' ? body.error : undefined;
  return new ApiError(status, code, body, message);
}

describe('humanizeRotarClaveError', () => {
  it('403 forbidden_impersonation_write → NO devuelve la copy de clave (no miente sobre la causa)', () => {
    // C2 (rojo antes del fix): la copy vieja devolvía CLAVE_MSG para cualquier
    // 403. Debe decir la verdad: el bloqueo es por impersonación, no por clave.
    const err = apiErrorFromBody(403, {
      error: 'forbidden_impersonation_write',
      code: 'forbidden_impersonation_write',
    });
    const msg = humanizeRotarClaveError(err);
    expect(msg).not.toBe(CLAVE_MSG);
    expect(msg).toMatch(/otro usuario|sal(?:ir)?\b|vista/i);
  });

  it('403 invalid_clave_anterior (wire real: solo `error`, sin `code`) → "La clave anterior no es correcta."', () => {
    // C3 no-regresión: el caso legítimo de clave incorrecta debe conservar su
    // texto — matcheado por el identificador real (`err.message`), no por status.
    const err = apiErrorFromBody(403, { error: 'invalid_clave_anterior' });
    expect(humanizeRotarClaveError(err)).toBe(CLAVE_MSG);
  });

  it('403 con code invalid_clave_anterior (por robustez si el backend lo agregara) → misma copy de clave', () => {
    const err = apiErrorFromBody(403, {
      error: 'invalid_clave_anterior',
      code: 'invalid_clave_anterior',
    });
    expect(humanizeRotarClaveError(err)).toBe(CLAVE_MSG);
  });

  it('404 user_not_found → mensaje de cuenta', () => {
    const err = apiErrorFromBody(404, { error: 'user_not_found' });
    expect(humanizeRotarClaveError(err)).toMatch(/no encontramos tu cuenta/i);
  });

  it('400 invalid_body → mensaje de 6 dígitos', () => {
    const err = apiErrorFromBody(400, { error: 'invalid_body' });
    expect(humanizeRotarClaveError(err)).toMatch(/6 dígitos/i);
  });

  it('otro 403 desconocido → mensaje veraz genérico, NUNCA la copy de clave', () => {
    // Blindaje forward-safe: un 403 futuro que no sea de clave tampoco debe
    // mentir diciendo "la clave anterior no es correcta".
    const err = apiErrorFromBody(403, { error: 'forbidden' });
    const msg = humanizeRotarClaveError(err);
    expect(msg).not.toBe(CLAVE_MSG);
  });

  it('error no-ApiError → devuelve el message del Error', () => {
    expect(humanizeRotarClaveError(new Error('boom'))).toBe('boom');
  });
});
