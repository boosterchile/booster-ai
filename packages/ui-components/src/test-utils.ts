import { axe } from 'vitest-axe';

/**
 * Corre axe-core sobre un contenedor renderizado, deshabilitando la regla
 * `color-contrast`: jsdom no tiene layout/canvas para medir contraste (de ahí
 * el warning de `getContext`), y el contraste de los tokens ya se verifica en
 * `@booster-ai/ui-tokens` (`contrast.test.ts`, WCAG AA). Acá axe cubre la a11y
 * semántica: roles, nombres accesibles, estados ARIA, labeling.
 */
export function axeCheck(container: Element): ReturnType<typeof axe> {
  return axe(container, { rules: { 'color-contrast': { enabled: false } } });
}
