import { expect, test } from '@playwright/test';
import { CREDENCIAL_T2, loginRutClave, reseedConductorE2e } from './helpers.js';

/**
 * Flujo conductor punta a punta (Slot 3 paso 6).
 *
 * Waits explícitos (`expect` / `waitForURL` / `expect.poll`).
 * Cero `waitForTimeout`. Certificado: no se exige PDF; basta métricas
 * y/o «Certificado en proceso» / degradación explícita (FAIL_ENV #692).
 */
test.use({
  geolocation: { latitude: -33.4372, longitude: -70.6506 },
  permissions: ['geolocation'],
});

test.describe('flujo conductor T2', () => {
  test.beforeEach(() => {
    reseedConductorE2e();
  });

  test('login → recogida → posición → entrega → resultado', async ({ page }) => {
    const posiciones: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/driver-position')) {
        posiciones.push(req.url());
      }
    });

    await loginRutClave(page, CREDENCIAL_T2.cond);
    await page.waitForURL(/\/app(\/conductor)?\/?$/, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/conductor/, { timeout: 20_000 });

    await expect(page.getByTestId('confirmar-recogida')).toBeVisible();

    // El origen del seed coincide con el geolocation mock: con permiso
    // granted el reporter arranca en `por_recoger` y manda el primer POST
    // (también habilita el body `picked_up_at` del geofence).
    await expect
      .poll(() => posiciones.length, {
        timeout: 25_000,
        message: 'esperaba ≥1 POST /driver-position antes de confirmar recogida',
      })
      .toBeGreaterThan(0);

    await page.getByTestId('confirmar-recogida').click();
    await page
      .getByTestId('confirmacion-inline')
      .getByRole('button', { name: 'Sí, confirmar' })
      .click();

    await expect(page.getByTestId('confirmar-entrega')).toBeVisible();

    await page.getByTestId('confirmar-entrega').click();
    await page
      .getByTestId('confirmacion-inline')
      .getByRole('button', { name: 'Sí, confirmar' })
      .click();

    await expect(page.getByText('Entrega confirmada. ¡Gracias!')).toBeVisible();
    const resultado = page.getByTestId('resultado-viaje');
    await expect(resultado).toBeVisible();
    await expect(resultado).toHaveText(
      /kg CO2e|Certificado en proceso|huella se está calculando|Tu empresa lo verá|Sin dato/i,
    );
  });
});
