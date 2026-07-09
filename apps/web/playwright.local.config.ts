import { defineConfig, devices } from '@playwright/test';

/**
 * Config E2E **local, de PR** — separada de `playwright.config.ts`
 * (nightly-vs-prod, 4 browsers, contra `BASE_URL` desplegada).
 *
 * Esta levanta el dev server de apps/web y corre **solo Chromium** contra
 * `/apariencia`, sin tocar prod/staging. Su razón de ser: verificar cascada CSS
 * computada y foco reales, que jsdom no puede (p.ej. el blindaje de #576). No
 * comparte `testDir`, `projects` ni `webServer` con la config de staging.
 */
const baseURL = 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e-local',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report-local' }], ['github']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // webServer siempre-on (a diferencia de la config de staging): la gracia de
  // este check es correr contra un server local, también en CI.
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
