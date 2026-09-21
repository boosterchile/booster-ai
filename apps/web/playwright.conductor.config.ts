import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del flujo conductor (Slot 3 paso 6) contra API local + Auth emulator.
 *
 * Distinto de `playwright.local.config.ts` (apariencia, sin backend) y de
 * `playwright.config.ts` (nightly vs prod). Este levanta el preview de
 * `apps/web` con `VITE_USE_AUTH_EMULATOR=true` y espera API `:8080` +
 * Auth emulator `:9099` + seed T2 (globalSetup).
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e-conductor',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report-conductor' }], ['github']],
  globalSetup: './e2e-conductor/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      VITE_USE_AUTH_EMULATOR: 'true',
      VITE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
    },
  },
});
