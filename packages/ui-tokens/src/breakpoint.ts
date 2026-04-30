/**
 * Breakpoints mobile-first.
 *
 * Match con Tailwind defaults para que `md:`, `lg:`, etc. matcheen el
 * design system 1:1.
 *
 * Uso real esperado:
 *   - sm: smartphones grandes / phablets
 *   - md: tablets vertical
 *   - lg: tablets landscape, laptops chicos
 *   - xl: desktops standard
 *   - 2xl: monitores grandes (operadores logística suelen tener 27"+)
 */
export const breakpoint = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export type Breakpoint = typeof breakpoint;
