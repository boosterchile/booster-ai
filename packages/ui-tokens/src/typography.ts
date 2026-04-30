/**
 * Tipografía de Booster AI.
 *
 * Familia: Inter como sans (universal, excelente legibilidad para datos
 * tabulares de logística). JetBrains Mono para mono (tracking codes,
 * placas, IDs técnicos donde la diferencia 0/O y 1/l/I importa).
 *
 * Escala: type scale modular ratio 1.25 desde 14px (cuerpo). Match con
 * Tailwind defaults pero documentado para que Claude Design lo pueda
 * leer y mantener consistencia entre prototipos y código.
 */

export const fontFamily = {
  sans: [
    'Inter',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
  mono: [
    'JetBrains Mono',
    'SF Mono',
    'Monaco',
    'Inconsolata',
    'Fira Mono',
    'Roboto Mono',
    'Menlo',
    'Consolas',
    'monospace',
  ],
} as const;

export const fontSize = {
  xs: '12px', // 0.75rem  — captions, metadata
  sm: '14px', // 0.875rem — body small, table cells
  base: '16px', // 1rem      — body default
  lg: '18px', // 1.125rem — body large, lead paragraph
  xl: '20px', // 1.25rem  — h5
  '2xl': '24px', // 1.5rem   — h4
  '3xl': '30px', // 1.875rem — h3
  '4xl': '36px', // 2.25rem  — h2
  '5xl': '48px', // 3rem     — h1
  '6xl': '60px', // 3.75rem  — display marketing
  '7xl': '72px', // 4.5rem   — display hero
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const lineHeight = {
  tight: 1.2, // headings
  snug: 1.35, // h5/h6 + lead paragraph
  normal: 1.5, // body
  relaxed: 1.625, // long-form reading
} as const;

export const letterSpacing = {
  tight: '-0.02em', // display headings
  normal: '0',
  wide: '0.02em', // uppercase labels
  wider: '0.06em', // small caps tracking
} as const;

/**
 * Estilos pre-compuestos — useables directamente en componentes para evitar
 * recombinar tokens y derivar el mismo estilo en múltiples lugares.
 */
export const textStyles = {
  display1: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize['6xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  h1: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize['5xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  h2: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
  },
  h3: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  h4: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  h5: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  bodyLarge: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.relaxed,
  },
  body: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize.base,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
  },
  bodySmall: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
  },
  caption: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.wide,
  },
  label: {
    fontFamily: fontFamily.sans,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
  },
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
} as const;

export type FontSize = typeof fontSize;
export type FontWeight = typeof fontWeight;
export type TextStyles = typeof textStyles;
