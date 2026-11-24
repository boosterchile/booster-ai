import { apiUrl, expect, test } from './fixtures.js';

/**
 * Humo sin sesión del entorno desplegado (.specs/e2e-staging). No necesita
 * usuario de prueba, así que corre siempre: es lo mínimo que una corrida
 * tiene que haber ejecutado para valer.
 */
test.describe('humo público', () => {
  test('la PWA carga y ofrece los tipos de acceso', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Bienvenido a Booster' })).toBeVisible();
    for (const tipo of ['carga', 'transporte', 'conductor']) {
      await expect(page.getByTestId(`login-tipo-${tipo}`)).toBeVisible();
    }
  });

  test('/app sin sesión lleva al login', async ({ page }) => {
    await page.goto('/app');
    await page.waitForURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Bienvenido a Booster' })).toBeVisible();
  });

  test('la activación del conductor se dibuja con sus cuatro campos', async ({ page }) => {
    await page.goto('/login/conductor');
    await expect(page.getByRole('heading', { name: 'Activa tu cuenta' })).toBeVisible();
    await expect(page.getByLabel('RUT')).toBeVisible();
    await expect(page.getByLabel('PIN de activación')).toBeVisible();
    await expect(page.getByLabel('Clave numérica')).toBeVisible();
    await expect(page.getByLabel('Repite tu clave')).toBeVisible();
  });

  test('la solicitud de acceso se dibuja', async ({ page }) => {
    await page.goto('/solicitar-acceso');
    await expect(page.getByRole('heading', { name: 'Solicita acceso' })).toBeVisible();
    await expect(page.getByLabel('Nombre completo')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('el api responde y protege sus rutas', async ({ request }) => {
    const api = apiUrl();

    const health = await request.get(`${api}/health`);
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', service: 'booster-ai-api' });

    const ready = await request.get(`${api}/ready`);
    expect(ready.status()).toBe(200);

    const me = await request.get(`${api}/me`);
    expect(me.status()).toBe(401);
  });
});
