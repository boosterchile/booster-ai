/**
 * Shadows. Discretos — Booster es B2B serio, no neumórfico ni glass-morphism.
 *
 *   xs: hairline para inputs y rows hover
 *   sm: cards default
 *   md: dropdowns, popovers
 *   lg: modals, dialogs
 *   xl: drawers, full-screen overlays
 *   inner: insets para wells (inputs focused, code blocks)
 */
export const shadow = {
  none: 'none',
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
  md: '0 4px 8px -2px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
  lg: '0 12px 16px -4px rgb(0 0 0 / 0.10), 0 4px 6px -2px rgb(0 0 0 / 0.05)',
  xl: '0 24px 48px -12px rgb(0 0 0 / 0.20)',
  '2xl': '0 32px 64px -16px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  /** Anillo de focus accesible (3:1 mínimo contra fondo blanco). */
  focusRing: '0 0 0 3px rgb(31 160 88 / 0.35)',
  focusRingDanger: '0 0 0 3px rgb(220 38 38 / 0.35)',
} as const;

export type Shadow = typeof shadow;
