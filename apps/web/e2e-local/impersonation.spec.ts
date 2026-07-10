import { expect, test } from '@playwright/test';

/**
 * Flujo de impersonación auditada verificado en Chromium real contra el preview
 * `/apariencia/impersonacion` (datos mock, sin backend/Firebase — no se puede
 * mintear tokens reales en e2e-local). Monta los `*View` de producción. El test
 * FALLA si el banner no aparece tras "Ver como" o si "Salir" no vuelve al login
 * — no son asserts que pasan siempre.
 */
test.describe('Impersonación — flujo en Chromium', () => {
  test('picker → ver como → banner aparece → salir → login', async ({ page }) => {
    await page.goto('/apariencia/impersonacion');

    // El picker lista usuarios de prueba con "Ver como" por fila.
    await expect(page.getByText('Ana Demo')).toBeVisible();
    const verComo = page.getByRole('button', { name: /Ver como/i }).first();
    await expect(verComo).toBeVisible();

    // Antes de impersonar, el banner NO está.
    await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);

    // "Ver como" → aparece el banner fijo con el nombre del target.
    await verComo.click();
    const banner = page.getByTestId('impersonation-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByText(/Ana Demo/)).toBeVisible();

    // "Salir" → vuelve al login (re-autenticación como admin).
    await banner.getByRole('button', { name: /Salir/i }).click();
    await expect(page).toHaveURL(/\/login/);
    // Y el banner desaparece.
    await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
  });
});
