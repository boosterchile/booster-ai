import { expect, test } from '@playwright/test';
import { CREDENCIAL_T2, loginRutClave } from './helpers.js';

test.describe('gate de rol /app/conductor', () => {
  test('un dueño generador en /app/conductor vuelve a /app', async ({ page }) => {
    await loginRutClave(page, CREDENCIAL_T2.gen);
    await page.waitForURL(/\/app\/?$/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/app\/conductor/);

    await page.goto('/app/conductor');
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page.getByTestId('confirmar-recogida')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Bienvenido a Booster/i })).toBeVisible();
  });
});
