import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { CREDENCIAL_F, reseedFlujosE2e } from './flujos.js';
import { loginCorreoClave, loginRutClave } from './helpers.js';

/**
 * El sello de huella en toda la web (`.specs/sello-huella-toda-la-web`,
 * criterio 5; frente 2 del rediseño). Con la siembra del frente 1 (un
 * certificado por presentación de ADR-091) recorre las pantallas con cifras de
 * huella y falla si una cifra de emisiones visible no está dentro de una
 * `CifraHuella` con su sello. Exige además ver las tres presentaciones.
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

interface Revision {
  /** Cifras de emisiones visibles en la pantalla. */
  cifras: number;
  /** Cifras sin sello: texto y lo que la rodea. */
  sinSello: string[];
  /** Presentaciones de los sellos que acompañan a las cifras. */
  presentaciones: string[];
}

/**
 * Recorre los nodos de texto visibles. Una cifra de emisiones es un número
 * seguido de «kg CO₂e», «t CO₂e» o «g CO₂e» (la intensidad incluida); un
 * factor de emisión («kg CO₂e/L») no es una huella y no cuenta.
 */
async function revisar(page: Page): Promise<Revision> {
  return await page.evaluate(() => {
    const cifra = /\d[\d.,]*\s*(?:kg|t|g)\s*CO₂e(?!\/L)/;
    const revision = { cifras: 0, sinSello: [] as string[], presentaciones: [] as string[] };
    const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) {
      const texto = nodo.textContent ?? '';
      const padre = nodo.parentElement;
      if (!padre || !cifra.test(texto) || padre.getClientRects().length === 0) {
        continue;
      }
      revision.cifras += 1;
      const contenedor = padre.closest('[data-cifra-huella]');
      const sello = contenedor?.querySelector('[data-presentacion]');
      if (!contenedor || !sello) {
        revision.sinSello.push(`«${texto.trim()}» en «${padre.parentElement?.innerText ?? ''}»`);
        continue;
      }
      revision.presentaciones.push(sello.getAttribute('data-presentacion') ?? '');
    }
    return revision;
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('sello de huella', () => {
  test.beforeAll(() => {
    reseedFlujosE2e();
    sembrar('mixta');
  });

  test('no hay cifra de emisiones sin sello y se ven las tres presentaciones', async ({
    page,
    browser,
  }) => {
    const porPantalla: Record<string, Revision> = {};

    await loginRutClave(page, TRANSPORTISTA);
    await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });

    // Certificados: el total y una fila por certificado.
    await page.goto('/app/certificados');
    await expect(page.getByTestId('certificados-emisiones')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'UVE-000003' })).toBeVisible();
    porPantalla.Certificados = await revisar(page);

    // Inicio del panel, con la empresa elegida.
    const contexto = await browser.newContext();
    const panel = await contexto.newPage();
    await loginCorreoClave(panel, CREDENCIAL_F.admin);
    await panel.waitForURL(/\/app\/platform-admin/, { timeout: 20_000 });
    await expect(panel.getByTestId('indicadores-negocio')).toBeVisible();
    await panel.getByTestId('indicadores-empresa').selectOption({ label: NOMBRE_EMPRESA });
    await expect(panel.getByTestId('indicador-emisiones')).toContainText('CO₂e');
    porPantalla['Inicio del panel'] = await revisar(panel);
    await contexto.close();

    const informe = JSON.stringify(porPantalla, null, 2);
    await test.info().attach('sellos-por-pantalla', {
      body: informe,
      contentType: 'application/json',
    });
    process.stdout.write(`Sellos por pantalla:\n${informe}\n`);

    for (const [pantalla, revision] of Object.entries(porPantalla)) {
      expect(revision.sinSello, `${pantalla}: cifras sin sello`).toEqual([]);
      // Que no haya cifras sin sello no prueba nada si no hay cifras.
      expect(revision.cifras, `${pantalla}: sin cifras de emisiones`).toBeGreaterThan(0);
      expect(new Set(revision.presentaciones), `${pantalla}: presentaciones`).toEqual(
        new Set(['primario', 'medido_teltonika', 'estimado']),
      );
    }
  });
});
