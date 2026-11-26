import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { CREDENCIAL_F, reseedFlujosE2e } from './flujos.js';
import { loginRutClave } from './helpers.js';

/**
 * Regresión visual del frente 8 (`.specs/frente8-regresion-visual/spec.md`): capturas
 * de los Inicios, Flota y Certificados a 1.280 y a 390 px, comparadas con las
 * de referencia de `regresion-visual.spec.ts-snapshots/`. Falla si una
 * pantalla cambia más que el umbral.
 *
 * Usa las mismas siembras que `una-sola-verdad.spec.ts` (empresa con servicio
 * completo, con Booster Fleet solo y mixta) y el generador del seed de flujos.
 *
 * Lo que cambia entre corridas sin que cambie la pantalla se neutraliza antes
 * de capturar: cifras y fechas (los vencimientos y los «hace N minutos» dependen
 * del día de la corrida), el saludo según la hora y los mapas (sin clave de
 * Google en el E2E). Así la comparación mira la forma: armazón, componentes,
 * columnas, colores y sellos.
 *
 * Las referencias se generan en Linux con el Chromium del CI. Para
 * regenerarlas: `pnpm --filter @booster-ai/web test:e2e:conductor
 * regresion-visual --update-snapshots` en un runner `ubuntu-24.04`.
 */
const TRANSPORTISTA = { rut: '74747474-5', clave: '482913', tipo: 'transporte' } as const;
const ANCHOS = [
  { nombre: '1280', width: 1280, height: 900 },
  { nombre: '390', width: 390, height: 844 },
] as const;

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

/**
 * Deja fijo lo que depende del día y de la hora: dígitos a 0, días y meses a
 * una palabra fija, el saludo a «Hola», y tapa los mapas con un bloque neutro.
 */
async function neutralizar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const palabras =
      /\b(lunes|martes|miércoles|jueves|viernes|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\b\.?/gi;
    const saludo = /\b(Buenos días|Buenas tardes|Buenas noches)\b/g;
    const caminante = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = caminante.nextNode(); n; n = caminante.nextNode()) {
      const t = n.nodeValue ?? '';
      const nuevo = t.replace(saludo, 'Hola').replace(palabras, 'día').replace(/\d/g, '0');
      if (nuevo !== t) {
        n.nodeValue = nuevo;
      }
    }
    for (const el of document.querySelectorAll('input')) {
      el.value = el.value.replace(/\d/g, '0');
    }
  });
  await page.addStyleTag({
    content:
      '.gm-style, [data-testid*="mapa"], [aria-label*="Mapa"], [aria-label*="mapa"] { visibility: hidden !important; } *, *::before, *::after { caret-color: transparent !important; }',
  });
}

/**
 * `listo`: uno o más data-testid separados por coma; se espera el primero
 * visible (hay bloques que solo existen en móvil o solo en escritorio).
 */
async function capturar(page: Page, url: string, nombre: string, listo: string): Promise<void> {
  const selector = listo
    .split(',')
    .map((id) => `[data-testid="${id.trim()}"]`)
    .join(', ');
  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho.width, height: ancho.height });
    await page.goto(url);
    await expect(page.locator(selector).filter({ visible: true }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await neutralizar(page);
    // Responsivo (frente 8): ninguna pantalla desborda a lo ancho; las tablas y
    // las pestañas se desplazan dentro de su caja.
    const desborde = await page.evaluate(() => {
      const ancho = document.documentElement.clientWidth;
      const fuera: string[] = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        const padre = el.parentElement?.getBoundingClientRect();
        if (r.width > 0 && r.right > ancho + 1 && padre && padre.right <= ancho + 1) {
          const caja = getComputedStyle(el.parentElement as Element).overflowX;
          if (caja !== 'auto' && caja !== 'scroll' && caja !== 'hidden') {
            fuera.push(
              `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(r.right)}px`,
            );
          }
        }
      }
      return { scroll: document.documentElement.scrollWidth - ancho, fuera: fuera.slice(0, 6) };
    });
    expect(desborde, `${nombre} a ${ancho.nombre} px desborda a lo ancho`).toEqual({
      scroll: 0,
      fuera: [],
    });
    await expect(page).toHaveScreenshot(`${nombre}-${ancho.nombre}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    });
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('regresión visual del frente 8', () => {
  test.beforeAll(() => {
    reseedFlujosE2e();
    sembrar('completo');
  });

  test('Inicios, Flota y Certificados de la empresa transportista', async ({ page }) => {
    await loginRutClave(page, TRANSPORTISTA);
    await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });

    await capturar(page, '/app', 'inicio-servicio-completo', 'inicio-transportista');
    await capturar(page, '/app/booster-fleet', 'flota', 'flota-camiones');

    sembrar('fleet');
    await capturar(page, '/app/booster-fleet', 'inicio-booster-fleet', 'flota-camiones');

    sembrar('mixta');
    await capturar(page, '/app', 'inicio-mixta', 'inicio-filtro-mixta');
    await capturar(page, '/app/certificados', 'certificados', 'certificados-emitidos');
  });

  test('Inicio del generador', async ({ page }) => {
    await loginRutClave(page, CREDENCIAL_F.gen);
    await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
    await capturar(page, '/app', 'inicio-generador', 'inicio-accesos, inicio-mapa-cargas');
  });
});
