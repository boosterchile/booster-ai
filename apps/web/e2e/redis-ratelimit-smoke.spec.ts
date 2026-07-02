import { expect, test } from '@playwright/test';

/**
 * Smoke E2E del fix de Redis TLS (.specs/redis-tls-ca-pinning) — GATEADO.
 *
 * Se SKIPEA salvo `RUN_PROD_SMOKE=1`: pega a PROD (api.boosterchile.com) y genera
 * intentos reales contra el rate-limit. Por eso NO corre en CI (la var no está
 * seteada) — mismo patrón que `perfil-validacion.spec.ts` con E2E_USER_*.
 *
 * Correr a mano (verificación post-deploy):
 *
 *   RUN_PROD_SMOKE=1 BASE_URL=https://app.boosterchile.com \
 *     pnpm --filter @booster-ai/web exec playwright test redis-ratelimit-smoke --project=chromium
 *
 * Qué prueba: el único path Redis observable desde el browser es el
 * `rate-limit-pin` de `POST /auth/driver-activate` (activación de conductor).
 *   - Redis sano  → el rate-limit dispara 429 (too_many_attempts) tras 5/15min.
 *   - Redis roto  → el middleware fail-closea con 503 service_unavailable en
 *     TODOS los intentos, y NUNCA aparece un 429 (el bug del incidente 2026-06-07).
 * El handler también puede devolver 401/410/503 `not_a_driver` según el RUT, por
 * eso la aserción dispositiva es la PRESENCIA de un 429, no el status 503.
 *
 * Nota: el contador es 5/15min por RUT; re-runs dentro de la ventana ven el 429
 * antes (igual cumple la aserción).
 */

const API = 'https://api.boosterchile.com';
// RUT con dígito verificador válido (mód 11) pero que no es un conductor real.
const FAKE_RUT = '9999999-3';

const SMOKE_ENABLED = process.env.RUN_PROD_SMOKE === '1';

test.describe('redis rate-limit prod smoke', () => {
  test.skip(!SMOKE_ENABLED, 'requiere RUN_PROD_SMOKE=1 (pega a prod; no corre en CI)');

  test('driver-activate rate-limit: aparece 429 (Redis OK), sin 503 fail-closed', async ({
    page,
  }) => {
    // 1. Smoke de browser: la PWA y la pantalla de conductor cargan.
    await page.goto('/login/conductor');
    await expect(page.getByRole('heading', { name: 'Acceso conductor' })).toBeVisible();

    // 2. Ejercita el path Redis: 6 POST seguidos (límite = 5/15min por RUT).
    const statuses: number[] = [];
    const bodies: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await page.request.post(`${API}/auth/driver-activate`, {
        headers: { 'content-type': 'application/json' },
        data: { rut: FAKE_RUT, pin: '000000' },
      });
      statuses.push(res.status());
      bodies.push(await res.text());
    }

    // Dispositivo: el rate-limit funcionando produce 429. Imposible con Redis caído.
    expect(statuses, `statuses=${JSON.stringify(statuses)}`).toContain(429);

    // Ningún 503 de fail-closed (firma del bug). Un 503 not_a_driver sí es aceptable.
    const failClosed = bodies.some((b) => b.includes('service_unavailable'));
    expect(failClosed, `bodies=${JSON.stringify(bodies)}`).toBe(false);
  });
});
