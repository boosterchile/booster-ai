import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { CREDENCIAL_F, reseedFlujosE2e } from './flujos.js';
import { loginCorreoClave, loginRutClave } from './helpers.js';

/**
 * Una sola verdad por dato (`.specs/una-sola-verdad-por-dato`, criterio 4;
 * frente 1 del rediseño). Carga la misma empresa en Flota, los dos Inicios
 * del transportista, Conductores, Certificados y el Inicio del panel, y falla
 * si dos pantallas muestran valores distintos para el mismo dato.
 *
 * La siembra (`apps/api/scripts/seed-una-verdad-e2e.ts`) cambia solo las
 * banderas de la empresa entre pantallas que se excluyen entre sí: el Inicio
 * con servicio completo exige que reciba ofertas, el de Booster Fleet solo
 * que no, y Certificados que sea generadora. Los camiones, documentos y
 * certificados son los mismos en todas.
 */
const TRANSPORTISTA = { rut: '74747474-5', clave: '482913', tipo: 'transporte' } as const;
const NOMBRE_EMPRESA = 'Transportes Una Verdad E2E SpA';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function sembrar(modo: 'completo' | 'fleet' | 'mixta'): void {
  execFileSync('pnpm', ['--filter', '@booster-ai/api', 'seed:una-verdad-e2e', `--modo=${modo}`], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-dev',
    },
  });
}

/** El primer número entero de un texto visible. */
async function entero(page: Page, testId: string, patron = /(\d+)/): Promise<number> {
  const elemento = page.getByTestId(testId);
  await expect(elemento).toBeVisible();
  const texto = await elemento.innerText();
  const valor = patron.exec(texto)?.[1];
  if (valor === undefined) {
    throw new Error(`«${testId}» no tiene una cifra: «${texto}»`);
  }
  return Number(valor);
}

async function texto(page: Page, testId: string): Promise<string> {
  const elemento = page.getByTestId(testId);
  await expect(elemento).toBeVisible();
  return (await elemento.innerText()).trim();
}

/** Lo que cada pantalla mostró, por dato, para el mensaje de falla. */
type Lecturas = Record<string, Record<string, number | string>>;

function mismoValor(lecturas: Lecturas, dato: string): void {
  const valores = lecturas[dato] ?? {};
  const distintos = new Set(Object.values(valores).map(String));
  expect(distintos.size, `«${dato}» difiere entre pantallas: ${JSON.stringify(valores)}`).toBe(1);
}

test.describe.configure({ mode: 'serial' });

test.describe('una sola verdad por dato', () => {
  test.beforeAll(() => {
    reseedFlujosE2e();
    sembrar('completo');
  });

  test('la misma empresa muestra las mismas cifras en todas las pantallas', async ({
    page,
    browser,
  }) => {
    const lecturas: Lecturas = {
      'documentos pendientes': {},
      camiones: {},
      'conductores con documentos pendientes': {},
      certificados: {},
      'emisiones certificadas': {},
    };
    const anotar = (dato: string, pantalla: string, valor: number | string) => {
      const porPantalla = lecturas[dato] ?? {};
      porPantalla[pantalla] = valor;
      lecturas[dato] = porPantalla;
    };

    await loginRutClave(page, TRANSPORTISTA);
    await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });

    // 1. Flota (servicio completo).
    await page.goto('/app/booster-fleet');
    anotar('documentos pendientes', 'Flota', await entero(page, 'flota-documentos-pendientes'));
    anotar('camiones', 'Flota', await entero(page, 'flota-camiones'));
    anotar(
      'conductores con documentos pendientes',
      'Flota',
      await entero(page, 'flota-documentos-pendientes-nota', /(\d+) conductor/),
    );

    // 2. Inicio con servicio completo.
    await page.goto('/app');
    await expect(page.getByTestId('inicio-transportista')).toBeVisible();
    anotar(
      'documentos pendientes',
      'Inicio con servicio completo',
      await entero(page, 'aviso-documentos'),
    );
    anotar(
      'camiones',
      'Inicio con servicio completo',
      await entero(page, 'inicio-camiones', /\/(\d+)/),
    );

    // 3. Cumplimiento.
    await page.goto('/app/cumplimiento');
    anotar(
      'documentos pendientes',
      'Cumplimiento',
      await entero(page, 'cumplimiento-documentos-pendientes'),
    );

    // 4. Conductores.
    await page.goto('/app/conductores');
    anotar(
      'conductores con documentos pendientes',
      'Conductores',
      await entero(page, 'conductores-con-documentos-pendientes'),
    );

    // 5. Inicio con Booster Fleet solo: el Inicio lleva al panel de Booster Fleet.
    sembrar('fleet');
    await page.goto('/app');
    await page.waitForURL(/\/app\/booster-fleet$/, { timeout: 20_000 });
    anotar(
      'documentos pendientes',
      'Inicio con Booster Fleet',
      await entero(page, 'flota-documentos-pendientes'),
    );
    anotar('camiones', 'Inicio con Booster Fleet', await entero(page, 'flota-camiones'));

    // 6. Certificados (la empresa también es generadora).
    sembrar('mixta');
    await page.goto('/app/certificados');
    anotar('certificados', 'Certificados', await entero(page, 'certificados-emitidos'));
    anotar('emisiones certificadas', 'Certificados', await texto(page, 'certificados-emisiones'));

    // 7. Inicio del panel, con la empresa elegida.
    const contexto = await browser.newContext();
    const panel = await contexto.newPage();
    await loginCorreoClave(panel, CREDENCIAL_F.admin);
    await panel.waitForURL(/\/app\/platform-admin/, { timeout: 20_000 });
    await expect(panel.getByTestId('indicadores-negocio')).toBeVisible();
    await panel.getByTestId('indicadores-empresa').selectOption({ label: NOMBRE_EMPRESA });
    await expect(panel.locator('[data-testid^="indicadores-de-"]')).not.toHaveAttribute(
      'data-testid',
      'indicadores-de-plataforma',
    );
    anotar(
      'documentos pendientes',
      'Inicio del panel',
      await entero(panel, 'indicador-documentos-pendientes'),
    );
    anotar('camiones', 'Inicio del panel', await entero(panel, 'indicador-camiones'));
    anotar('certificados', 'Inicio del panel', await entero(panel, 'indicador-certificados'));
    anotar('emisiones certificadas', 'Inicio del panel', await texto(panel, 'indicador-emisiones'));
    await contexto.close();

    const informe = JSON.stringify(lecturas, null, 2);
    await test.info().attach('lecturas-por-pantalla', {
      body: informe,
      contentType: 'application/json',
    });
    process.stdout.write(`Lecturas por pantalla:\n${informe}\n`);

    for (const dato of Object.keys(lecturas)) {
      mismoValor(lecturas, dato);
    }
    // Que coincidan en cero no prueba nada: la siembra deja cada dato con valor.
    expect(lecturas['documentos pendientes']?.Flota).toBeGreaterThan(0);
    expect(lecturas.camiones?.Flota).toBeGreaterThan(0);
    expect(lecturas['conductores con documentos pendientes']?.Flota).toBeGreaterThan(0);
    expect(lecturas.certificados?.Certificados).toBeGreaterThan(0);
    expect(String(lecturas['emisiones certificadas']?.Certificados)).toMatch(/CO₂e/);
  });
});
