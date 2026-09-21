import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect } from '@playwright/test';

export const CREDENCIAL_T2 = {
  gen: { rut: '72727272-0', clave: '482913', tipo: 'carga' },
  tra: { rut: '70707070-6', clave: '482913', tipo: 'transporte' },
  cond: { rut: '71717171-3', clave: '482913', tipo: 'conductor' },
} as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Re-corre el seed T2 (idempotente). Hace falta en `beforeEach` del flujo:
 * un retry de Playwright no vuelve a correr `globalSetup`, y una asignación
 * ya entregada dejaría el segundo intento vacío.
 */
export function reseedConductorE2e(): void {
  execFileSync('pnpm', ['--filter', '@booster-ai/api', 'seed:conductor-e2e'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-dev',
    },
  });
}

export async function loginRutClave(
  page: Page,
  cred: { rut: string; clave: string; tipo: string },
): Promise<void> {
  await page.goto(`/login?tipo=${cred.tipo}`);
  const form = page.getByTestId('login-universal-form');
  const tipoBtn = page.getByTestId(`login-tipo-${cred.tipo}`);
  // Flag universal o `?tipo=` strippado: o el form, o el selector de tipo.
  await expect(form.or(tipoBtn)).toBeVisible();
  if (await tipoBtn.isVisible()) {
    await tipoBtn.click();
  }
  await expect(form).toBeVisible();
  await page.getByTestId('login-rut-input').fill(cred.rut);
  await page.getByTestId('login-clave-input').fill(cred.clave);
  await page.getByTestId('login-submit').click();
}
