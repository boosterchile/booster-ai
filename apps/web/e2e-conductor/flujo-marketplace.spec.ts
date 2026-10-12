import { expect, test } from '@playwright/test';
import { revisarPantalla } from './a11y.js';
import { CREDENCIAL_F, datetimeLocal, reseedFlujosE2e } from './flujos.js';
import { loginRutClave } from './helpers.js';

/**
 * T10-10 — flujos críticos del marketplace, en serie porque cada paso parte
 * del anterior: el generador publica, el transportista acepta la oferta que
 * el matching le dejó y el enlace de seguimiento público muestra el viaje.
 * Cada pantalla pasa axe sin violaciones serias ni críticas (T10-11).
 */
test.describe.configure({ mode: 'serial' });

test.describe('marketplace: publicar → aceptar → tracking público', () => {
  let tracking = '';
  let cargaUrl = '';

  test.beforeAll(() => {
    reseedFlujosE2e();
  });

  test('el generador publica una carga y el matching envía ofertas', async ({ page }) => {
    await loginRutClave(page, CREDENCIAL_F.gen);
    await page.waitForURL(/\/app\/?$/, { timeout: 20_000 });
    await revisarPantalla(page, '/app (generador)');

    await page.goto('/app/cargas/nueva');
    await expect(page.getByRole('heading', { name: 'Nueva carga' })).toBeVisible();
    await revisarPantalla(page, '/app/cargas/nueva');

    // 3.3.1 / 3.3.3: enviar sin los datos obligatorios marca cada campo y
    // describe el error.
    await page.getByRole('button', { name: 'Crear carga' }).click();
    await revisarPantalla(page, '/app/cargas/nueva (errores)', { errores: true });

    const regiones = page.getByRole('combobox', { name: 'Región' });
    await page.getByLabel('Dirección de recogida').fill('Av. Apoquindo 5550, Las Condes');
    await regiones.nth(0).selectOption('XIII');
    await page.getByLabel('Dirección de entrega').fill('Av. Pajaritos 3000, Maipú');
    await regiones.nth(1).selectOption('XIII');
    await page.getByLabel('Peso (kg)').fill('8000');
    const desde = new Date(Date.now() + 2 * 3_600_000);
    const hasta = new Date(Date.now() + 6 * 3_600_000);
    await page.getByLabel('Desde').fill(datetimeLocal(desde));
    await page.getByLabel('Hasta').fill(datetimeLocal(hasta));
    await page.getByLabel('Precio sugerido (CLP)').fill('450000');
    await page.getByRole('button', { name: 'Crear carga' }).click();

    await page.waitForURL(/\/app\/cargas\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    cargaUrl = new URL(page.url()).pathname;
    await expect(page.getByText('Ofertas enviadas').first()).toBeVisible();
    tracking = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
    expect(tracking).not.toBe('');
    await revisarPantalla(page, '/app/cargas/:id (ofertas enviadas)');
  });

  test('el transportista acepta la oferta', async ({ page }) => {
    expect(tracking, 'requiere la carga del paso anterior').not.toBe('');
    await loginRutClave(page, CREDENCIAL_F.tra);
    await page.waitForURL(/\/app\/?$/, { timeout: 20_000 });

    await page.goto('/app/ofertas');
    await expect(page.getByRole('heading', { name: 'Ofertas activas' })).toBeVisible();
    const tarjeta = page
      .locator('article, li, div')
      .filter({ hasText: tracking })
      .filter({
        has: page.getByRole('button', { name: 'Aceptar oferta' }),
      });
    await expect(tarjeta.last()).toBeVisible({ timeout: 20_000 });
    await revisarPantalla(page, '/app/ofertas');

    await tarjeta.last().getByRole('button', { name: 'Aceptar oferta' }).click();
    await page.waitForURL(/\/app\/asignaciones\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByText(tracking).first()).toBeVisible();
    await revisarPantalla(page, '/app/asignaciones/:id');
  });

  test('el enlace de seguimiento público muestra el viaje sin sesión', async ({
    page,
    browser,
  }, testInfo) => {
    expect(cargaUrl, 'requiere la carga del paso anterior').not.toBe('');
    await loginRutClave(page, CREDENCIAL_F.gen);
    await page.waitForURL(/\/app\/?$/, { timeout: 20_000 });
    await page.goto(cargaUrl);
    await expect(page.getByText('Asignado').first()).toBeVisible({ timeout: 20_000 });
    const enlace = page.getByRole('link', { name: 'Enlace de seguimiento público' });
    await expect(enlace).toBeVisible();
    const href = await enlace.getAttribute('href');
    expect(href).toMatch(/\/tracking\/[0-9a-f-]{36}$/);

    // Sin sesión: un contexto nuevo, como el destinatario que abre el link.
    const anonimo = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const publica = await anonimo.newPage();
      await publica.goto(new URL(href ?? '').pathname);
      const estado = publica.getByTestId('status-card');
      await expect(estado).toBeVisible({ timeout: 20_000 });
      await expect(estado).toContainText('Asignado');
      await expect(estado).toContainText(tracking);
      await revisarPantalla(publica, '/tracking/:token');

      await publica.goto('/tracking/00000000-0000-4000-8000-000000000000');
      await expect(publica.getByText('Link de seguimiento no válido')).toBeVisible();
    } finally {
      await anonimo.close();
    }
  });
});
