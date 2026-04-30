/**
 * Escala de spacing. Base 4px, modular linear hasta 16, después saltos
 * geométricos. Match con Tailwind para que las clases coincidan con el
 * design system sin sorpresas.
 *
 * Uso: gaps, paddings, margins. Para layout grid usar fracciones.
 */
export const spacing = {
  0: '0px',
  px: '1px',
  '0.5': '2px',
  1: '4px',
  '1.5': '6px',
  2: '8px',
  '2.5': '10px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  10: '40px',
  12: '48px',
  14: '56px',
  16: '64px',
  20: '80px',
  24: '96px',
  28: '112px',
  32: '128px',
  40: '160px',
  48: '192px',
  56: '224px',
  64: '256px',
  72: '288px',
  80: '320px',
  96: '384px',
} as const;

export type Spacing = typeof spacing;
