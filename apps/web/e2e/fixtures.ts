import { type Browser, type Page, test as base, expect } from '@playwright/test';

/**
 * Utilidades de la suite que corre contra un entorno desplegado (staging).
 * Ver .specs/e2e-staging.
 *
 * Sesión: login universal por RUT y clave numérica (ADR-035), por los mismos
 * `data-testid` que usa la suite local (`e2e-conductor/helpers.ts`).
 *
 * Usuarios de prueba, sembrados por `scripts/db/seed-staging-e2e.sh`. Sus
 * credenciales vienen del entorno y nunca del repo:
 *   E2E_TRANSPORTISTA_RUT / E2E_TRANSPORTISTA_CLAVE   dueño de la empresa transportista
 *   E2E_GENERADOR_RUT     / E2E_GENERADOR_CLAVE       dueña de la empresa generadora
 *
 * El login por RUT tiene un límite de 5 intentos cada 15 minutos que cuenta
 * también los exitosos, y en staging nadie lo limpia entre corridas. Por eso
 * cada rol entra UNA vez por corrida (`abrirSesion` en `beforeAll`) y las
 * pruebas con sesión corren en un solo navegador (`noEsChromiumDeEscritorio`).
 */

export type Rol = 'transportista' | 'generador';

const TIPO_DE_ACCESO: Record<Rol, 'transporte' | 'carga'> = {
  transportista: 'transporte',
  generador: 'carga',
};

function credencial(rol: Rol): { rut: string | undefined; clave: string | undefined } {
  return rol === 'transportista'
    ? { rut: process.env.E2E_TRANSPORTISTA_RUT, clave: process.env.E2E_TRANSPORTISTA_CLAVE }
    : { rut: process.env.E2E_GENERADOR_RUT, clave: process.env.E2E_GENERADOR_CLAVE };
}

/** True si el entorno trae el usuario de prueba de ese rol. Sin él, sus pruebas se saltan. */
export function hayCredenciales(rol: Rol): boolean {
  const { rut, clave } = credencial(rol);
  return Boolean(rut && clave);
}

/**
 * Condición de `test.skip` para las pruebas con sesión: corren solo en el
 * proyecto `chromium` de escritorio (ver arriba). `mobile-chrome` también es
 * Chromium, por eso se mira además `isMobile`.
 */
export function noEsChromiumDeEscritorio({
  browserName,
  isMobile,
}: { browserName: string; isMobile: boolean }): boolean {
  return browserName !== 'chromium' || isMobile;
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
  cred: { rut: string; clave: string; tipo: 'transporte' | 'carga' },
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

/**
 * Abre una página con la sesión del rol ya iniciada. Pensada para `beforeAll`:
 * un solo login por rol y por corrida. Quien la abre la cierra en `afterAll`.
 */
export async function abrirSesion(browser: Browser, rol: Rol): Promise<Page> {
  const { rut, clave } = credencial(rol);
  if (!rut || !clave) {
    throw new Error(
      `Faltan las credenciales del ${rol}: la prueba debe saltarse con hayCredenciales().`,
    );
  }
  const page = await browser.newPage();
  await loginRutClave(page, { rut, clave, tipo: TIPO_DE_ACCESO[rol] });
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  return page;
}

export const test = base;
export { expect };
