import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderThemeCss } from './css.js';

/**
 * Drift-guard de la fuente única (D1 H3). Si alguien edita un token TS sin
 * regenerar `theme.css` (o edita el CSS a mano), este test falla y bloquea el
 * CI. Corre en el `pnpm test` del monorepo — no necesita runner ni wiring
 * aparte. Regenerar: `pnpm --filter @booster-ai/ui-tokens gen:css`.
 */
describe('theme.css (fuente única TS→CSS)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const themeCssPath = join(here, '..', 'theme.css');

  it('el theme.css committeado coincide con regenerar desde los tokens', () => {
    const committed = readFileSync(themeCssPath, 'utf8');
    expect(committed).toBe(renderThemeCss());
  });

  it('mapea el acento a variables indirectas (theming en runtime)', () => {
    const css = renderThemeCss();
    expect(css).toContain('--color-accent-600: var(--accent-600);');
    // default operador (Índigo) anclado en :root
    expect(css).toContain(":root,\n[data-accent='indigo']");
    // presets de ambas paletas presentes (operador + conductor LED)
    for (const key of ['indigo', 'berenjena', 'azul-led', 'verde-led', 'fluor', 'negro']) {
      expect(css).toContain(`[data-accent='${key}']`);
    }
  });

  it('los tokens FIJOS no son swappables (primary/neutral con hex, no var)', () => {
    const css = renderThemeCss();
    expect(css).toContain('--color-primary-500: #1FA058;');
    expect(css).toContain('--color-neutral-50: #FAF9F7;');
  });

  it('emite registro/densidad CSS-driven (calc con base inlineada + --density-scale)', () => {
    const css = renderThemeCss();
    // default operador anclado en :root; --touch-min piso (no escalado)
    expect(css).toContain(":root,\n[data-register='operador']");
    expect(css).toContain('--touch-min: 44px;');
    // conductor holgado (guantes/movimiento) — base mayor
    expect(css).toContain("[data-register='conductor']");
    expect(css).toContain('--touch-min: 56px;');
    // padding = base literal * var(--density-scale) → re-cascadea por subtree
    expect(css).toContain('--pad-y: calc(0.5rem * var(--density-scale));');
    expect(css).toContain('--pad-y: calc(0.875rem * var(--density-scale));');
    // densidad: solo multiplicador, default cómoda en :root
    expect(css).toContain(":root,\n[data-density='comoda']");
    expect(css).toContain('--density-scale: 1;');
    expect(css).toContain("[data-density='compacta']");
    expect(css).toContain('--density-scale: 0.8;');
  });
});
