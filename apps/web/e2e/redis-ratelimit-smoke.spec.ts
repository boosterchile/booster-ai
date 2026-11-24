import { apiUrl, esStaging, expect, test } from './fixtures.js';

/**
 * Smoke del límite de intentos que depende de Redis (.specs/redis-tls-ca-pinning,
 * .specs/e2e-staging) — GATEADO.
 *
 * Solo corre con `RUN_RATELIMIT_SMOKE=1` y contra staging: genera intentos
 * reales contra el rate limit. `e2e-staging.yml` lo activa cuando el destino
 * es staging; contra prod no corre nunca.
 *
 * Correr a mano:
 *
 *   RUN_RATELIMIT_SMOKE=1 BASE_URL=https://app.staging.boosterchile.com \
 *     pnpm --filter @booster-ai/web exec playwright test redis-ratelimit-smoke --project=chromium
 *
 * Qué prueba: el único path Redis observable desde fuera es el
 * `rate-limit-pin` de `POST /auth/driver-activate` (activación de conductor).
 *   - Redis sano → el límite dispara 429 (`too_many_attempts`) tras 5 intentos
 *     en 15 minutos por RUT.
 *   - Redis roto → el middleware cierra con 503 `service_unavailable` en TODOS
 *     los intentos y nunca aparece un 429 (el incidente del 2026-06-07).
 * El handler puede devolver además 400, 401, 410 o 503 `not_a_driver` según el
 * cuerpo y el RUT; por eso la aserción decisiva es la PRESENCIA de un 429.
 *
 * El contador es por RUT: una segunda corrida dentro de la ventana ve el 429
 * antes, y la aserción se cumple igual.
 */

// RUT con dígito verificador válido (módulo 11) que no es un conductor real.
const RUT_FICTICIO = '9999999-3';

const HABILITADO = process.env.RUN_RATELIMIT_SMOKE === '1';

test.describe('smoke de rate limit sobre Redis', () => {
  test.skip(!HABILITADO, 'requiere RUN_RATELIMIT_SMOKE=1 (genera intentos reales)');
  test.skip(HABILITADO && !esStaging(), 'solo corre contra staging, nunca contra prod');

  test('driver-activate: aparece un 429 y ningún 503 de fail-closed', async ({ request }) => {
    const api = apiUrl();
    const estados: number[] = [];
    const cuerpos: string[] = [];
    // El límite es 5 cada 15 minutos por RUT: el sexto intento debe dar 429.
    for (let i = 0; i < 6; i++) {
      const res = await request.post(`${api}/auth/driver-activate`, {
        headers: { 'content-type': 'application/json' },
        data: { rut: RUT_FICTICIO, pin: '000000', clave_numerica: '000000' },
      });
      estados.push(res.status());
      cuerpos.push(await res.text());
    }

    expect(estados, `estados=${JSON.stringify(estados)}`).toContain(429);

    // Ningún 503 de fail-closed (la firma del incidente). Un 503 `not_a_driver` sí es aceptable.
    const cerroPorRedis = cuerpos.some((c) => c.includes('service_unavailable'));
    expect(cerroPorRedis, `cuerpos=${JSON.stringify(cuerpos)}`).toBe(false);
  });
});
