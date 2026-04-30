/**
 * Transition durations + easings.
 *
 * Booster prefiere micro-interacciones rápidas (150-250ms) — la app es
 * operacional, no entretenimiento. Animaciones largas frustran cuando
 * hay que aceptar/rechazar 50 ofertas seguidas.
 */
export const duration = {
  instant: '0ms',
  fast: '120ms', // hover, focus
  default: '200ms', // most transitions
  slow: '320ms', // entering modals, layout shifts
  slower: '480ms', // page transitions
} as const;

export const easing = {
  linear: 'linear',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)', // default
  out: 'cubic-bezier(0, 0, 0.2, 1)', // entrar (más rápido al final)
  in: 'cubic-bezier(0.4, 0, 1, 1)', // salir (más rápido al inicio)
  spring: 'cubic-bezier(0.5, 1.5, 0.5, 1)', // bounce sutil para confirmaciones
} as const;

export type Duration = typeof duration;
export type Easing = typeof easing;
