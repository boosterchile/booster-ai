import { type Page, test as base, expect } from '@playwright/test';

/**
 * Fixtures de la suite que corre contra un entorno desplegado (staging).
 * Ver .specs/e2e-staging.
 *
 * Sesión: login universal por RUT y clave numérica (ADR-035), por los mismos
 * `data-testid` que usa la suite local (`e2e-conductor/helpers.ts`). Firebase
 * guarda la sesión en IndexedDB y Playwright no la captura en `storageState`,
 * así que cada test entra por la interfaz.
 *
 * Credenciales del usuario de prueba, que vienen del entorno y nunca del repo:
 *   E2E_USER_RUT    RUT del usuario.
 *   E2E_USER_CLAVE  Su clave numérica de 6 dígitos (secreto).
 *   E2E_USER_TIPO   Tipo de acceso: `transporte` (por defecto) o `carga`.
 */

export type AuthFixtures = {
  authenticatedPage: Page;
};

type TipoAcceso = 'transporte' | 'carga';

/** True si el entorno trae el usuario de prueba. Sin él, los tests de sesión se saltan. */
export function hasE2ECredentials(): boolean {
  return Boolean(process.env.E2E_USER_RUT && process.env.E2E_USER_CLAVE);
}

function tipoAcceso(): TipoAcceso {
  return process.env.E2E_USER_TIPO === 'carga' ? 'carga' : 'transporte';
}

/**
 * URL del api del entorno bajo prueba. `E2E_API_URL` si viene; si no, la de
 * `BASE_URL` cambiando el primer `app.` del host por `api.`, que es la
 * convención de prod y de staging.
 */
export function apiUrl(): string {
  const explicita = process.env.E2E_API_URL;
  if (explicita) {
    return explicita.replace(/\/$/, '');
  }
  const base = new URL(process.env.BASE_URL ?? 'http://localhost:5173');
  if (!base.hostname.startsWith('app.')) {
    throw new Error(
      `No se puede derivar el api desde BASE_URL=${base.origin}: define E2E_API_URL.`,
    );
  }
  base.hostname = base.hostname.replace(/^app\./, 'api.');
  return base.origin;
}

/** True si el entorno bajo prueba es staging, por el host de `BASE_URL`. */
export function esStaging(): boolean {
  const host = new URL(process.env.BASE_URL ?? 'http://localhost:5173').hostname;
  return host.split('.').includes('staging');
}

export async function loginRutClave(
  page: Page,
  cred: { rut: string; clave: string; tipo: TipoAcceso },
): Promise<void> {
  await page.goto(`/login?tipo=${cred.tipo}`);
  const form = page.getByTestId('login-universal-form');
  const tipoBtn = page.getByTestId(`login-tipo-${cred.tipo}`);
  // Con `?tipo=` la interfaz muestra el formulario; sin él, el selector de tipo.
  await expect(form.or(tipoBtn)).toBeVisible();
  if (await tipoBtn.isVisible()) {
    await tipoBtn.click();
  }
  await expect(form).toBeVisible();
  await page.getByTestId('login-rut-input').fill(cred.rut);
  await page.getByTestId('login-clave-input').fill(cred.clave);
  await page.getByTestId('login-submit').click();
}

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    const rut = process.env.E2E_USER_RUT;
    const clave = process.env.E2E_USER_CLAVE;
    if (!rut || !clave) {
      throw new Error(
        'E2E_USER_RUT / E2E_USER_CLAVE no definidas: el test debe saltarse con hasE2ECredentials().',
      );
    }
    await loginRutClave(page, { rut, clave, tipo: tipoAcceso() });
    await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
    await use(page);
  },
});

export { expect };
