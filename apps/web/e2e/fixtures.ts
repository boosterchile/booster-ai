import { type Page, test as base } from '@playwright/test';

/**
 * Fixtures Playwright con login automático.
 *
 * Firebase persiste el estado auth en IndexedDB; Playwright 1.49 todavía
 * no expone `storageState({ indexedDB: true })` (llega en 1.51), así
 * que en lugar de capturar storage hacemos login por UI antes de cada
 * test. Es más lento pero confiable y evita inyectar tokens a mano.
 *
 * Credenciales: vienen de `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`. Si
 * faltan, el test que use la fixture lanza error y debe skipearse a
 * nivel describe (ver `perfil-validacion.spec.ts` para el patrón).
 */

export type AuthFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      throw new Error(
        'E2E_USER_EMAIL / E2E_USER_PASSWORD no definidas. Configurar en CI vars (GitLab) o local antes de correr tests E2E.',
      );
    }

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: /Entrar/i }).click();
    await page.waitForURL(/\/app(\/|$)/, { timeout: 15_000 });

    await use(page);
  },
});

export { expect } from '@playwright/test';

/**
 * Helper: chequea si las credenciales E2E están disponibles.
 * Útil para `test.describe.configure({ mode: 'skip' })` condicional.
 */
export function hasE2ECredentials(): boolean {
  return Boolean(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);
}
