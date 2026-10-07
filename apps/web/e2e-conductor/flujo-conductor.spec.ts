import { expect, test } from '@playwright/test';
import {
  CREDENCIAL_T2,
  PIN_ACTIVACION_T2,
  activarConductor,
  loginRutClave,
  reseedConductorE2e,
} from './helpers.js';

/**
 * Flujo conductor punta a punta (Slot 3 paso 6; T10-02 de ADR-082).
 *
 * Empieza donde empieza un conductor real: su empresa lo dio de alta y le
 * entregó un PIN. Activa, opera el viaje y al final vuelve a entrar con la
 * clave que eligió, que es su única credencial.
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

  test('activar → recogida → posición → entrega → resultado → login con su clave', async ({
    page,
    browser,
  }, testInfo) => {
    const posiciones: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/driver-position')) {
        posiciones.push(req.url());
      }
    });

    await activarConductor(page, CREDENCIAL_T2.cond, PIN_ACTIVACION_T2);
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

    // La credencial es la clave elegida, no el PIN: sesión nueva, login principal.
    const otraSesion = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const pagina = await otraSesion.newPage();
      await loginRutClave(pagina, CREDENCIAL_T2.cond);
      await expect(pagina).toHaveURL(/\/app\/conductor/, { timeout: 20_000 });
    } finally {
      await otraSesion.close();
    }
  });
});
