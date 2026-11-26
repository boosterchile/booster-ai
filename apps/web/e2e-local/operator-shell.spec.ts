import { expect, test } from '@playwright/test';

/**
 * Armazón de operador (`.specs/frente8-menu-superior`) en Chromium real contra
 * el preview `/apariencia/shell?rol=…` (me mock, sin backend). Falla si el
 * menú muestra entradas del rol equivocado, si a 390 px no aparece la barra
 * inferior o si a 1.280 px aparece.
 */
const principal = 'Navegación principal';
const movil = 'Navegación principal en móvil';

test.describe('Armazón operador — menú superior', () => {
  test('1.280 px: menú superior con las entradas del transportista, sin barra inferior', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/apariencia/shell?rol=transportista');
    const menu = page.getByRole('navigation', { name: principal, exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link')).toHaveText([
      'Inicio',
      'Flota',
      'Viajes',
      'Ofertas',
      'Empresa',
    ]);
    await expect(page.getByRole('navigation', { name: movil })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Mis cargas' })).toHaveCount(0);
  });

  test('1.280 px: el generador ve sus entradas y no las del transportista', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/apariencia/shell?rol=generador');
    const menu = page.getByRole('navigation', { name: principal, exact: true });
    await expect(menu.getByRole('link')).toHaveText([
      'Inicio',
      'Mis cargas',
      'Huella y certificados',
      'Empresa',
    ]);
    await expect(menu.getByRole('link', { name: 'Ofertas' })).toHaveCount(0);
  });

  test('390 px: barra inferior fija con las entradas y el menú superior oculto', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apariencia/shell?rol=transportista');
    await expect(page.getByRole('navigation', { name: principal, exact: true })).toBeHidden();
    const barra = page.getByRole('navigation', { name: movil });
    await expect(barra).toBeVisible();
    await expect(barra.getByRole('link')).toHaveCount(5);
    const caja = await barra.boundingBox();
    expect(caja).not.toBeNull();
    // Pegada al borde inferior del viewport.
    expect(Math.round((caja?.y ?? 0) + (caja?.height ?? 0))).toBe(844);
  });

  test('menú de cuenta: abre con el perfil y Salir', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/apariencia/shell?rol=dual');
    await page.getByTestId('menu-cuenta').click();
    await expect(page.getByRole('link', { name: 'Mi perfil' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Mi perfil' })).toHaveCount(0);
  });
});
