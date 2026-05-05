import { expect, hasE2ECredentials, test } from './fixtures.js';

/**
 * FIX-009 — validación de perfil.
 *
 * Cubre:
 *   - inputs de teléfono y WhatsApp tienen `type="tel"` (teclado
 *     numérico mobile).
 *   - validación inline de formato chileno (vía chileanPhoneSchema).
 *   - RUT readonly se muestra con puntos cuando ya está declarado.
 *
 * Skip si no hay credenciales E2E configuradas — los tests requieren
 * un user real (Firebase + onboarding completado) en el entorno
 * apuntado por BASE_URL.
 */

test.describe('FIX-009: validación de perfil @bug', () => {
  test.skip(!hasE2ECredentials(), 'E2E_USER_EMAIL / E2E_USER_PASSWORD no configuradas');

  test('input de teléfono tiene type="tel"', async ({ authenticatedPage: page }) => {
    await page.goto('/app/perfil');
    const phone = page.getByLabel(/Teléfono móvil/i);
    await expect(phone).toHaveAttribute('type', 'tel');
    await expect(phone).toHaveAttribute('inputmode', 'tel');
  });

  test('input de WhatsApp tiene type="tel"', async ({ authenticatedPage: page }) => {
    await page.goto('/app/perfil');
    const whatsapp = page.getByLabel(/WhatsApp/i);
    await expect(whatsapp).toHaveAttribute('type', 'tel');
    await expect(whatsapp).toHaveAttribute('inputmode', 'tel');
  });

  test('teléfono con formato inválido muestra error al guardar', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app/perfil');
    const phone = page.getByLabel(/Teléfono móvil/i);
    await phone.fill('123');
    await page.getByRole('button', { name: /Guardar cambios/i }).click();
    await expect(page.getByText(/Número de teléfono Chile inválido/i)).toBeVisible();
  });

  test('RUT readonly se muestra con puntos cuando ya está declarado', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app/perfil');
    const rut = page.getByLabel(/RUT/i);
    await expect(rut).toBeDisabled();
    const value = await rut.inputValue();
    // Si el user de test ya tiene RUT declarado, debe verse formateado:
    // patrón XX.XXX.XXX-X (puntos cada 3 dígitos + DV).
    if (value) {
      expect(value).toMatch(/^\d{1,2}(\.\d{3}){1,2}-[\dkK]$/);
    }
  });
});
