import { expect, test } from '@playwright/test';

/**
 * Shell de operador (sidebar D2) verificado en Chromium real contra el preview
 * `/apariencia/shell?rol=…` (me mock, sin backend). Cada test FALLA si el
 * sidebar muestra items del rol equivocado o si el drawer móvil no funciona —
 * no son asserts que pasan siempre.
 */
test.describe('Shell operador — sidebar en Chromium', () => {
  test('transportista ve SUS items del sidebar y NO los de generador', async ({ page }) => {
    await page.goto('/apariencia/shell?rol=transportista');
    await expect(page.getByRole('link', { name: 'Ofertas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vehículos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Liquidaciones' })).toBeVisible();
    // items de generador NO deben aparecer
    await expect(page.getByRole('link', { name: 'Mis cargas' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sucursales' })).toHaveCount(0);
  });

  test('generador ve SUS items del sidebar y NO los de transportista', async ({ page }) => {
    await page.goto('/apariencia/shell?rol=generador');
    await expect(page.getByRole('link', { name: 'Mis cargas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Crear carga' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ofertas' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Liquidaciones' })).toHaveCount(0);
  });

  test('desktop: hamburguesa oculta, sidebar visible', async ({ page }) => {
    await page.goto('/apariencia/shell?rol=dual');
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Ofertas' })).toBeVisible();
  });

  test('móvil: el sidebar colapsa a drawer y se abre/cierra por el toggle', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/apariencia/shell?rol=transportista');

    // Cerrado: hamburguesa visible; el sidebar desktop está en el DOM pero oculto.
    const hamburger = page.getByRole('button', { name: 'Abrir menú' });
    await expect(hamburger).toBeVisible();
    await expect(page.getByTestId('mobile-drawer')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ofertas' })).toBeHidden();

    // Abrir el drawer.
    await hamburger.click();
    const drawer = page.getByTestId('mobile-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Ofertas' })).toBeVisible();

    // Cerrar por el backdrop: click en la zona destapada (a la derecha del
    // drawer w-72=288px; el viewport es 375px de ancho).
    await page.mouse.click(350, 400);
    await expect(page.getByTestId('mobile-drawer')).toHaveCount(0);
  });
});
