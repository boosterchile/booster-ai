import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect } from '@playwright/test';

export const CREDENCIAL_T2 = {
  gen: { rut: '72727272-0', clave: '482913', tipo: 'carga' },
  tra: { rut: '70707070-6', clave: '482913', tipo: 'transporte' },
  // El conductor no tiene clave hasta activarse: la elige en `/login/conductor`.
  cond: { rut: '71717171-3', clave: '135790', tipo: 'conductor' },
} as const;

/**
 * PIN que el seed T2 deja en el conductor, como si su empresa lo acabara de
 * dar de alta (`POST /conductores`). Sirve una sola vez.
 */
export const PIN_ACTIVACION_T2 = '246810';

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

/**
 * Activación del conductor por la pantalla pública: RUT + PIN de su empresa
 * + la clave que elige. Termina con sesión en `/app/conductor`.
 */
export async function activarConductor(
  page: Page,
  cred: { rut: string; clave: string },
  pin: string,
): Promise<void> {
  await page.goto('/login/conductor');
  await expect(page.getByRole('heading', { name: 'Activa tu cuenta' })).toBeVisible();
  await page.getByLabel('RUT').fill(cred.rut);
  await page.getByLabel('PIN de activación').fill(pin);
  await page.getByLabel('Clave numérica').fill(cred.clave);
  await page.getByLabel('Repite tu clave').fill(cred.clave);
  await page.getByRole('button', { name: 'Activar mi cuenta' }).click();
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
