import type { Page } from '@playwright/test';
import {
  abrirSesion,
  expect,
  hayCredenciales,
  noEsChromiumDeEscritorio,
  test,
} from './fixtures.js';

/**
 * Sesión de la generadora de carga de prueba (.specs/e2e-staging).
 *
 * Se salta sin `E2E_GENERADOR_RUT` y `E2E_GENERADOR_CLAVE`. Un solo login
 * para todo el archivo: ver el límite de intentos en `fixtures.ts`.
 */
test.describe('generador con sesión: inicio', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !hayCredenciales('generador'),
    'E2E_GENERADOR_RUT / E2E_GENERADOR_CLAVE no configuradas',
  );
  test.skip(noEsChromiumDeEscritorio, 'las pruebas con sesión corren solo en chromium');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await abrirSesion(browser, 'generador');
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('entra con RUT y clave y queda dentro de /app', async () => {
    await expect(page).toHaveURL(/\/app(\/|$)/);
    await expect(page.getByTestId('login-universal-form')).toHaveCount(0);
  });

  test('su sesión sobrevive a una recarga', async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/app(\/|$)/);
  });
});
