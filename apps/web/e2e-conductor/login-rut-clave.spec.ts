import { expect, test } from '@playwright/test';
import { expectSinViolacionesGraves } from './a11y.js';
import { CREDENCIAL_F, reseedFlujosE2e } from './flujos.js';
import { loginRutClave } from './helpers.js';

/** T10-10 — login con RUT y clave: la clave equivocada no entra; la correcta sí. */
test.describe('login con RUT y clave', () => {
  test.beforeAll(() => {
    reseedFlujosE2e();
  });

  test('clave incorrecta muestra el error; la correcta entra a /app', async ({ page }) => {
    await loginRutClave(page, { ...CREDENCIAL_F.tra, clave: '000000' });
    await expect(page.getByRole('alert')).toContainText(
      'RUT o clave incorrectos. Verifica e intenta de nuevo.',
    );
    await expect(page).toHaveURL(/\/login/);
    await expectSinViolacionesGraves(page, '/login (error)');

    await page.getByTestId('login-clave-input').fill(CREDENCIAL_F.tra.clave);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/app\/?$/, { timeout: 20_000 });
    await expectSinViolacionesGraves(page, '/app (transportista)');
  });
});
