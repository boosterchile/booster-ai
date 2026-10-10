import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect } from '@playwright/test';

/**
 * T10-11 — axe sobre la pantalla actual con las reglas WCAG 2.1 A/AA.
 * Falla si hay alguna violación `serious` o `critical`; las `moderate` y
 * `minor` quedan para la auditoría (`docs/audits/wcag-*.md`).
 *
 * El mensaje lista regla, impacto y los primeros selectores afectados para
 * que el fallo se pueda corregir sin abrir el reporte.
 */
export async function expectSinViolacionesGraves(page: Page, pantalla: string): Promise<void> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const graves = resultado.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const resumen = graves.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
  expect(resumen, `axe en ${pantalla}`).toEqual([]);
}

export interface OpcionesRevision {
  /**
   * 3.3.1 / 3.3.3 — la pantalla muestra errores de formulario: cada campo con
   * `aria-invalid="true"` debe apuntar con `aria-describedby` a un texto, y
   * debe haber al menos uno.
   */
  errores?: boolean;
  /** 4.1.3 — mensaje de resultado que debe estar en una región viva. */
  estado?: Locator;
}

/**
 * T10-11 — revisión de la pantalla actual: axe (A1), reflow a 320 y 640 px
 * (A2), teclado y foco visible (A3) y, si el paso lo pide, errores y
 * mensajes de estado (A4). `.specs/wcag-revision-t10-11/spec.md`.
 */
export async function revisarPantalla(
  page: Page,
  pantalla: string,
  opciones: OpcionesRevision = {},
): Promise<void> {
  await expectSinViolacionesGraves(page, pantalla);
  await expectTeclado(page, pantalla);
  await expectReflow(page, pantalla);
  if (opciones.errores) {
    await expectErroresAsociados(page, pantalla);
  }
  if (opciones.estado) {
    await expectEnRegionViva(opciones.estado, pantalla);
  }
}

const SELECTOR_ENFOCABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Marca usada para identificar controles entre `page.evaluate` sucesivos. */
const ATRIBUTO_ID = 'data-a11y-id';

interface EstiloFoco {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  borderColor: string;
  backgroundColor: string;
  textDecorationLine: string;
}

/**
 * A3 — 2.1.1 (todo control se alcanza con Tab), 2.1.2 (sin trampa de foco)
 * y 2.4.7 (foco visible). Recorre la pantalla desde el inicio del documento
 * con Tab y compara el estilo de cada control enfocado con su estilo sin foco
 * (propio y de dos ancestros, para indicadores `focus-within`).
 */
async function expectTeclado(page: Page, pantalla: string): Promise<void> {
  // La foto "sin foco" se toma sin ningún control enfocado (el paso anterior
  // del test puede haber dejado el foco en el último campo que llenó).
  await page.evaluate(() => {
    const activo = document.activeElement;
    if (activo instanceof HTMLElement) {
      activo.blur();
    }
    // Igual que al leer con foco: valores finales, sin transiciones a medias.
    for (const animacion of document.getAnimations()) {
      if (animacion instanceof CSSTransition) {
        animacion.finish();
      }
    }
  });
  const controles = await page.evaluate(
    ({ selector, atributo }) => {
      const leer = (el: Element) => {
        const s = getComputedStyle(el);
        return {
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          outlineColor: s.outlineColor,
          boxShadow: s.boxShadow,
          borderColor: s.borderColor,
          backgroundColor: s.backgroundColor,
          textDecorationLine: s.textDecorationLine,
        };
      };
      const visible = (el: Element) => {
        if (!(el instanceof HTMLElement)) {
          return false;
        }
        if (el.closest('[inert]')) {
          return false;
        }
        if ((el as HTMLButtonElement).disabled) {
          return false;
        }
        if (el instanceof HTMLInputElement && el.type === 'hidden') {
          return false;
        }
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none') {
          return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const lista = [...document.querySelectorAll(selector)].filter(visible);
      return lista.map((el, i) => {
        el.setAttribute(atributo, String(i));
        const cadena = [el, el.parentElement, el.parentElement?.parentElement].filter(
          (x): x is HTMLElement => x instanceof HTMLElement,
        );
        return {
          id: String(i),
          descripcion: `${el.tagName.toLowerCase()} «${(
            (el as HTMLInputElement).labels?.[0]?.innerText ??
            el.getAttribute('aria-label') ??
            (el as HTMLElement).innerText ??
            el.getAttribute('name') ??
            ''
          )
            .trim()
            .slice(0, 40)}»`,
          // Los inputs de fecha y hora reparten el foco entre sus segmentos
          // (día, mes, año, hora, minuto): cada uno consume un Tab.
          pasos:
            el instanceof HTMLInputElement &&
            ['date', 'datetime-local', 'time', 'month', 'week'].includes(el.type)
              ? 6
              : 1,
          sinFoco: cadena.map(leer),
        };
      });
    },
    { selector: SELECTOR_ENFOCABLE, atributo: ATRIBUTO_ID },
  );

  // Punto de partida limpio: un centinela al inicio del documento.
  await page.evaluate(() => {
    const centinela = document.createElement('div');
    centinela.id = '__a11y_inicio';
    centinela.tabIndex = 0;
    centinela.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;';
    document.body.prepend(centinela);
    centinela.focus();
  });

  const alcanzados = new Set<string>();
  const sinIndicador: string[] = [];
  let volvio = false;
  const maximo = controles.reduce((n, c) => n + c.pasos, 0) + 10;
  try {
    for (let i = 0; i < maximo; i++) {
      await page.keyboard.press('Tab');
      const foco = await page.evaluate(
        ({ atributo }) => {
          const el = document.activeElement;
          if (!el || el === document.body || el.id === '__a11y_inicio') {
            return { fin: true as const };
          }
          const leer = (x: Element) => {
            const s = getComputedStyle(x);
            return {
              outlineStyle: s.outlineStyle,
              outlineWidth: s.outlineWidth,
              outlineColor: s.outlineColor,
              boxShadow: s.boxShadow,
              borderColor: s.borderColor,
              backgroundColor: s.backgroundColor,
              textDecorationLine: s.textDecorationLine,
            };
          };
          const cadena = [el, el.parentElement, el.parentElement?.parentElement].filter(
            (x): x is HTMLElement => x instanceof HTMLElement,
          );
          // El indicador puede llegar con `transition` (150 ms): se leen los
          // valores finales, que son los que ve la persona.
          for (const x of cadena) {
            for (const animacion of x.getAnimations()) {
              if (animacion instanceof CSSTransition) {
                animacion.finish();
              }
            }
          }
          return {
            fin: false as const,
            id: el.getAttribute(atributo),
            iframe: el.tagName === 'IFRAME',
            // Foco en una parte interna del control nativo (el ícono de
            // calendario de un input de fecha): el host no matchea `:focus`
            // y el anillo lo dibuja Chromium dentro de su shadow DOM, que
            // getComputedStyle no ve. Verificado con captura (2026-10-10).
            focoInternoNativo: el.matches(':focus-within') && !el.matches(':focus'),
            conFoco: cadena.map(leer),
          };
        },
        { atributo: ATRIBUTO_ID },
      );
      if (foco.fin) {
        volvio = true;
        break;
      }
      if (foco.iframe || foco.id === null) {
        continue;
      }
      alcanzados.add(foco.id);
      const control = controles.find((c) => c.id === foco.id);
      if (control && !foco.focoInternoNativo && !tieneIndicador(control.sinFoco, foco.conFoco)) {
        sinIndicador.push(control.descripcion);
      }
    }
  } finally {
    await page.evaluate(
      ({ atributo }) => {
        document.getElementById('__a11y_inicio')?.remove();
        for (const el of document.querySelectorAll(`[${atributo}]`)) {
          el.removeAttribute(atributo);
        }
      },
      { atributo: ATRIBUTO_ID },
    );
  }

  const noAlcanzados = controles.filter((c) => !alcanzados.has(c.id)).map((c) => c.descripcion);
  expect.soft(volvio, `2.1.2 trampa de foco en ${pantalla}: ${maximo} Tab sin salir`).toBe(true);
  expect.soft(noAlcanzados, `2.1.1 controles sin alcanzar con Tab en ${pantalla}`).toEqual([]);
  expect
    .soft([...new Set(sinIndicador)], `2.4.7 foco sin indicador visible en ${pantalla}`)
    .toEqual([]);
}

/** Transparente: `rgba(…, 0)` o la palabra `transparent`. */
function esTransparente(color: string): boolean {
  return color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
}

function tieneIndicador(sinFoco: EstiloFoco[], conFoco: EstiloFoco[]): boolean {
  const propio = conFoco[0];
  if (
    propio &&
    propio.outlineStyle !== 'none' &&
    Number.parseFloat(propio.outlineWidth) >= 1 &&
    !esTransparente(propio.outlineColor)
  ) {
    return true;
  }
  return conFoco.some((estilo, i) => {
    const antes = sinFoco[i];
    if (!antes) {
      return false;
    }
    return (
      estilo.boxShadow !== antes.boxShadow ||
      estilo.borderColor !== antes.borderColor ||
      estilo.backgroundColor !== antes.backgroundColor ||
      estilo.textDecorationLine !== antes.textDecorationLine ||
      (estilo.outlineStyle !== antes.outlineStyle && estilo.outlineStyle !== 'none')
    );
  });
}

/**
 * A2 — 1.4.10 reflow a 320 px CSS (equivale a 400 % sobre 1280) y 640 px
 * (200 %, 1.4.4): sin scroll horizontal del documento y sin elementos que
 * desborden el viewport fuera de un contenedor con scroll horizontal propio
 * (excepción de 1.4.10 para contenido bidimensional).
 */
async function expectReflow(page: Page, pantalla: string): Promise<void> {
  const original = page.viewportSize();
  try {
    for (const ancho of [320, 640]) {
      await page.setViewportSize({ width: ancho, height: 640 });
      await page.waitForTimeout(250);
      const medida = await page.evaluate(() => {
        const doc = document.scrollingElement ?? document.documentElement;
        const ancho = document.documentElement.clientWidth;
        const conScrollPropio = (el: Element) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll') {
              return true;
            }
          }
          return false;
        };
        const desbordes: string[] = [];
        for (const el of document.body.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement)) {
            continue;
          }
          const s = getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') {
            continue;
          }
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) {
            continue;
          }
          if (r.right <= ancho + 1) {
            continue;
          }
          if (conScrollPropio(el)) {
            continue;
          }
          // Solo el desborde más externo: los hijos de un desborde ya cuentan.
          if (el.parentElement && el.parentElement.getBoundingClientRect().right > ancho + 1) {
            continue;
          }
          desbordes.push(
            `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
              el.getAttribute('data-testid')
                ? `[data-testid=${el.getAttribute('data-testid')}]`
                : ''
            } «${(el.innerText ?? '').trim().slice(0, 30)}» → ${Math.round(r.right)}px`,
          );
        }
        return { scroll: doc.scrollWidth - doc.clientWidth, desbordes: desbordes.slice(0, 8) };
      });
      expect
        .soft(
          { scrollHorizontal: medida.scroll > 1, desbordes: medida.desbordes },
          `1.4.10 reflow a ${ancho}px en ${pantalla}`,
        )
        .toEqual({ scrollHorizontal: false, desbordes: [] });
    }
  } finally {
    if (original) {
      await page.setViewportSize(original);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}

/** A4 — 3.3.1 / 3.3.3: los campos con error describen el error. */
async function expectErroresAsociados(page: Page, pantalla: string): Promise<void> {
  const campos = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-invalid="true"]')].map((el) => {
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      const texto = ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      return {
        campo: el.getAttribute('name') ?? el.id ?? el.tagName.toLowerCase(),
        describe: texto.length > 0,
      };
    }),
  );
  expect
    .soft(campos.length, `3.3.1 sin campos marcados aria-invalid en ${pantalla}`)
    .toBeGreaterThan(0);
  expect
    .soft(
      campos.filter((c) => !c.describe).map((c) => c.campo),
      `3.3.1 campos con error sin descripción asociada en ${pantalla}`,
    )
    .toEqual([]);
}

/** A4 — 4.1.3: el mensaje está dentro de una región viva. */
export async function expectEnRegionViva(mensaje: Locator, pantalla: string): Promise<void> {
  await expect(mensaje).toBeVisible();
  const enRegion = await mensaje.evaluate(
    (el) =>
      el.closest(
        '[role="alert"], [role="status"], [role="log"], output, [aria-live]:not([aria-live="off"])',
      ) !== null,
  );
  expect.soft(enRegion, `4.1.3 mensaje fuera de una región viva en ${pantalla}`).toBe(true);
}
