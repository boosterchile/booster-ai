/**
 * Paleta de color de Booster AI.
 *
 * Fundamento del sistema visual. Cualquier color que aparezca en la UI tiene
 * que venir de aquí — nunca un hex inline. Si necesitás un tono nuevo,
 * agregalo en este archivo y deciles a quien diseñe que está disponible.
 *
 * Principios:
 *   1. Primary verde Booster — comunica sostenibilidad + confianza B2B.
 *      No es turquesa startup ni verde militar; es un verde "logística
 *      operativa" maduro.
 *   2. Neutrals cálidos (no slate frío) — para que la UI se lea como
 *      empresa chilena, no como dashboard SaaS gringo.
 *   3. Accent ámbar — para urgencia (offers expiran, tracking en vivo).
 *   4. Semantic claro: success verde, warning ámbar, danger rojo, info azul.
 *      Nunca reusar primary para semantic — confunde estado con marca.
 */

const primary = {
  50: '#ECFAF1',
  100: '#D1F2DD',
  200: '#A5E3BA',
  300: '#73D094',
  400: '#42BB72',
  500: '#1FA058', // Booster green — primary brand
  600: '#168047',
  700: '#10653A',
  800: '#0C4D2D',
  900: '#083823',
  950: '#04231A',
} as const;

const neutral = {
  0: '#FFFFFF',
  50: '#FAF9F7',
  100: '#F4F2EE',
  200: '#E7E4DD',
  300: '#D5D1C7',
  400: '#A6A199',
  500: '#73706A',
  600: '#56544F',
  700: '#3F3D39',
  800: '#2A2926',
  900: '#1A1917',
  1000: '#0A0A09',
} as const;

const accent = {
  50: '#FFF7EB',
  100: '#FFEAC9',
  200: '#FFD489',
  300: '#FFB94A',
  400: '#FFA21F',
  500: '#F58A00', // urgencia / tracking en vivo
  600: '#CC6F00',
  700: '#A05500',
  800: '#7A4100',
  900: '#542C00',
} as const;

const success = {
  50: '#ECFAF1',
  500: '#1FA058',
  600: '#168047',
  700: '#10653A',
} as const;

const warning = {
  50: '#FFF7EB',
  500: '#F58A00',
  600: '#CC6F00',
  700: '#A05500',
} as const;

const danger = {
  50: '#FEF2F2',
  500: '#DC2626',
  600: '#B91C1C',
  700: '#991B1B',
} as const;

const info = {
  50: '#EFF6FF',
  500: '#2563EB',
  600: '#1D4ED8',
  700: '#1E40AF',
} as const;

export const colors = {
  primary,
  neutral,
  accent,
  success,
  warning,
  danger,
  info,
} as const;

export type ColorScale = typeof primary;
export type Colors = typeof colors;

/**
 * Aliases semánticos. La UI debe usar estos en lugar de hardcodear escalas
 * para que un cambio de tema (light → dark, slice 2+) sea de un solo lugar.
 */
export const semanticColors = {
  // Backgrounds
  bgCanvas: neutral[50],
  bgSurface: neutral[0],
  bgSubtle: neutral[100],
  bgMuted: neutral[200],
  bgInverse: neutral[900],

  // Text
  textPrimary: neutral[900],
  textSecondary: neutral[700],
  textTertiary: neutral[500],
  textInverse: neutral[0],
  textOnPrimary: neutral[0],
  textOnAccent: neutral[1000],
  textBrand: primary[600],
  textDanger: danger[600],

  // Borders
  borderSubtle: neutral[200],
  borderDefault: neutral[300],
  borderStrong: neutral[400],
  borderBrand: primary[500],
  borderDanger: danger[500],

  // Brand
  brandPrimary: primary[500],
  brandPrimaryHover: primary[600],
  brandPrimaryActive: primary[700],

  // Accent (urgencia, CTAs secundarios)
  accentPrimary: accent[500],
  accentPrimaryHover: accent[600],

  // Status
  statusSuccessBg: success[50],
  statusSuccessFg: success[700],
  statusWarningBg: warning[50],
  statusWarningFg: warning[700],
  statusDangerBg: danger[50],
  statusDangerFg: danger[700],
  statusInfoBg: info[50],
  statusInfoFg: info[700],
} as const;

export type SemanticColors = typeof semanticColors;
