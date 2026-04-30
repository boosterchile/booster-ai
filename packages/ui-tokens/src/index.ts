/**
 * @booster-ai/ui-tokens
 *
 * Design tokens de Booster AI. Fuente única de verdad para todo el sistema
 * visual. Consumido por:
 *   - apps/web (Tailwind config, componentes React)
 *   - apps/marketing (mismo design system)
 *   - Claude Design (lee este package + DESIGN.md como brief de marca)
 *
 * Si modificás algo aquí, revisá el DESIGN.md en el root del repo para
 * mantener consistencia con la guía de marca y vuelve a generar cualquier
 * prototipo en Claude Design para que tome los nuevos valores.
 */

export * from './colors.js';
export * from './typography.js';
export * from './spacing.js';
export * from './radius.js';
export * from './shadow.js';
export * from './breakpoint.js';
export * from './z-index.js';
export * from './duration.js';

import { breakpoint } from './breakpoint.js';
import { colors, semanticColors } from './colors.js';
import { duration, easing } from './duration.js';
import { radius } from './radius.js';
import { shadow } from './shadow.js';
import { spacing } from './spacing.js';
import { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight } from './typography.js';
import { zIndex } from './z-index.js';

/**
 * Tokens agregados — útil para configurar Tailwind o CSS-in-JS de un solo
 * import:
 *
 *   import { tokens } from '@booster-ai/ui-tokens';
 *   const tw = { theme: { colors: tokens.colors, ... } };
 */
export const tokens = {
  colors,
  semanticColors,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  spacing,
  radius,
  shadow,
  breakpoint,
  zIndex,
  duration,
  easing,
} as const;

export type Tokens = typeof tokens;
