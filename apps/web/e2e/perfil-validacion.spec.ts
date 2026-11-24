import type { Page } from '@playwright/test';
import {
  abrirSesion,
  expect,
  hayCredenciales,
  noEsChromiumDeEscritorio,
  test,
} from './fixtures.js';

/**
 * Sesión del transportista de prueba (.specs/e2e-staging) y FIX-009,
 * validación de perfil:
 *   - los campos de teléfono y WhatsApp tienen `type="tel"` (teclado numérico
 *     en el móvil);
 *   - validación inline del formato chileno (vía chileanPhoneSchema);
 *   - el RUT, de solo lectura, se muestra con puntos.
 *
 * Se salta sin `E2E_TRANSPORTISTA_RUT` y `E2E_TRANSPORTISTA_CLAVE`. Un solo
 * login para todo el archivo: ver el límite de intentos en `fixtures.ts`.
 */
test.describe('transportista con sesión: inicio y perfil @bug', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !hayCredenciales('transportista'),
    'E2E_TRANSPORTISTA_RUT / E2E_TRANSPORTISTA_CLAVE no configuradas',
  );
  test.skip(noEsChromiumDeEscritorio, 'las pruebas con sesión corren solo en chromium');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await abrirSesion(browser, 'transportista');
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('entra con RUT y clave y queda dentro de /app', async () => {
    await expect(page).toHaveURL(/\/app(\/|$)/);
    await expect(page.getByTestId('login-universal-form')).toHaveCount(0);
  });

  test('input de teléfono tiene type="tel"', async () => {
    await page.goto('/app/perfil');
    const phone = page.getByLabel(/Teléfono celular/i);
    await expect(phone).toHaveAttribute('type', 'tel');
    await expect(phone).toHaveAttribute('inputmode', 'tel');
  });

  test('input de WhatsApp tiene type="tel"', async () => {
    await page.goto('/app/perfil');
    const whatsapp = page.getByLabel(/WhatsApp/i);
    await expect(whatsapp).toHaveAttribute('type', 'tel');
    await expect(whatsapp).toHaveAttribute('inputmode', 'tel');
  });

  test('teléfono con formato inválido muestra error al guardar', async () => {
    await page.goto('/app/perfil');
    const phone = page.getByLabel(/Teléfono celular/i);
    await phone.fill('123');
    await page.getByRole('button', { name: /Guardar cambios/i }).click();
    await expect(page.getByText('Ingresa un teléfono válido, como +56912345678')).toBeVisible();
  });

  test('RUT readonly se muestra con puntos cuando ya está declarado', async () => {
    await page.goto('/app/perfil');
    const rut = page.getByLabel(/RUT/i);
    await expect(rut).toBeDisabled();
    const value = await rut.inputValue();
    // El usuario de prueba tiene RUT: debe verse formateado, XX.XXX.XXX-X.
    if (value) {
      expect(value).toMatch(/^\d{1,2}(\.\d{3}){1,2}-[\dkK]$/);
    }
  });
});
