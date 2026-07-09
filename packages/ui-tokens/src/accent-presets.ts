/**
 * Acento customizable del registro "producto" — DOS paletas por ROL
 * (DESIGN.md D-3/D-4/D-5; decisión del PO 2026-07-09).
 *
 * El acento cambia en runtime (theming vía `data-accent` en <html> → bloque
 * `[data-accent]` del theme generado). La base cálida, el primario y los
 * SEMÁNTICOS quedan FIJOS; solo el acento cambia — como el tablero del auto
 * que no cambia con los LED de cabina.
 *
 * - **Operador** (sobria/profesional): 6 presets. Default = Índigo.
 * - **Conductor** (LED vibrante, inspiración cabina de vehículo): 7 presets.
 *   Default = Azul LED.
 *
 * Los hex se generaron y VERIFICARON con `contrast.test.ts` (WCAG AA en claro y
 * oscuro; botón ~600 + blanco ≥4.5; nunca negro sobre el fill del botón). No
 * editar un hex a mano sin correr el test.
 */

export interface ColorRamp {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export type AccentPalette = 'operator' | 'conductor';

export type OperatorAccentKey =
  | 'indigo'
  | 'oceano'
  | 'ciruela'
  | 'pizarra'
  | 'cobalto'
  | 'berenjena';
export type ConductorAccentKey =
  | 'ambar-led'
  | 'naranjo-led'
  | 'rojo-led'
  | 'azul-led'
  | 'verde-led'
  | 'fluor'
  | 'negro';
export type AccentPresetKey = OperatorAccentKey | ConductorAccentKey;

export const ACCENT_PRESET_LABEL: Record<AccentPresetKey, string> = {
  // Operador
  indigo: 'Índigo',
  oceano: 'Azul océano',
  ciruela: 'Ciruela',
  pizarra: 'Pizarra',
  cobalto: 'Cobalto',
  berenjena: 'Berenjena',
  // Conductor (LED)
  'ambar-led': 'Ámbar LED',
  'naranjo-led': 'Naranjo LED',
  'rojo-led': 'Rojo LED',
  'azul-led': 'Azul LED',
  'verde-led': 'Verde LED',
  fluor: 'Fluor',
  negro: 'Negro',
};

/** Paleta OPERADOR — sobria (reusa las rampas de D1; sin cambios de hex). */
export const operatorPresets: Record<OperatorAccentKey, ColorRamp> = {
  indigo: {
    50: '#EEF0FB',
    100: '#DADEF5',
    200: '#BAC2EC',
    300: '#909CDD',
    400: '#6675CB',
    500: '#4553B5',
    600: '#3B4496',
    700: '#2F3878',
    800: '#282F60',
    900: '#1E2347',
  },
  oceano: {
    50: '#E9F3FA',
    100: '#CBE4F2',
    200: '#9BCAE6',
    300: '#5EA9D4',
    400: '#2E88BE',
    500: '#1D6E9E',
    600: '#175A82',
    700: '#164A69',
    800: '#163E57',
    900: '#122E40',
  },
  ciruela: {
    50: '#F9EEF3',
    100: '#F0D4E0',
    200: '#E0A9C2',
    300: '#CB789F',
    400: '#B4507D',
    500: '#993A63',
    600: '#7F3052',
    700: '#682843',
    800: '#552138',
    900: '#3C1727',
  },
  pizarra: {
    50: '#EEF1F4',
    100: '#DAE0E6',
    200: '#B9C4CF',
    300: '#8F9EAF',
    400: '#697A8D',
    500: '#4F6072',
    600: '#404E5D',
    700: '#36414D',
    800: '#2E3742',
    900: '#212830',
  },
  cobalto: {
    50: '#EBF1FE',
    100: '#D3E1FC',
    200: '#A7C4F9',
    300: '#729EF2',
    400: '#4278E6',
    500: '#255BD0',
    600: '#1D49AA',
    700: '#1B3E8A',
    800: '#1B3670',
    900: '#152449',
  },
  berenjena: {
    50: '#F4EFF8',
    100: '#E6D8F0',
    200: '#CCB1E0',
    300: '#AC81CC',
    400: '#8F57B4',
    500: '#763F9A',
    600: '#61337E',
    700: '#4F2B65',
    800: '#412453',
    900: '#2C1839',
  },
};

/** Paleta CONDUCTOR — LED vibrante. El fill del botón (~600) va oscurecido
 * para llevar texto blanco; lo vibrante vive en stops bajos + el glow. */
export const conductorPresets: Record<ConductorAccentKey, ColorRamp> = {
  'ambar-led': {
    50: '#FEF3C7',
    100: '#FDE49A',
    200: '#FBD24F',
    300: '#EFB528',
    400: '#CF9412',
    500: '#AE7B0E',
    600: '#8F650C',
    700: '#75530E',
    800: '#5E4310',
    900: '#43300C',
  },
  'naranjo-led': {
    50: '#FFEDD5',
    100: '#FED7AA',
    200: '#FDBA74',
    300: '#F7913A',
    400: '#E06614',
    500: '#C24E10',
    600: '#A5410E',
    700: '#87360F',
    800: '#6E2E10',
    900: '#4C2010',
  },
  'rojo-led': {
    50: '#FCE7E7',
    100: '#F9CFCF',
    200: '#F0A3A3',
    300: '#E17070',
    400: '#CE3F3F',
    500: '#B92B2B',
    600: '#9E2222',
    700: '#831D1D',
    800: '#6B1B1B',
    900: '#4C1414',
  },
  'azul-led': {
    50: '#E0EDFF',
    100: '#C2D8FF',
    200: '#93BCFB',
    300: '#5F97F5',
    400: '#3570E0',
    500: '#2559CC',
    600: '#1E4FBA',
    700: '#1C3F93',
    800: '#1E3A8A',
    900: '#16265C',
  },
  'verde-led': {
    50: '#E4F7D9',
    100: '#C9EFB0',
    200: '#A3E07C',
    300: '#79C748',
    400: '#549F20',
    500: '#478718',
    600: '#3E7D14',
    700: '#336212',
    800: '#2C5016',
    900: '#1E380F',
  },
  fluor: {
    50: '#D6F7F7',
    100: '#A5EFEF',
    200: '#5FE0E0',
    300: '#22C2C2',
    400: '#0F9E9E',
    500: '#0D8686',
    600: '#0C7A7A',
    700: '#0A6262',
    800: '#0A4A4A',
    900: '#073232',
  },
  negro: {
    50: '#EDEDEC',
    100: '#DBDBD9',
    200: '#B9B9B6',
    300: '#909090',
    400: '#6B6B67',
    500: '#4E4E4A',
    600: '#3A3A37',
    700: '#2C2C2A',
    800: '#1C1C1B',
    900: '#111110',
  },
};

/** Todas las rampas (para el codegen: emite un bloque [data-accent] por preset). */
export const allAccentPresets: Record<AccentPresetKey, ColorRamp> = {
  ...operatorPresets,
  ...conductorPresets,
};

export const OPERATOR_DEFAULT: OperatorAccentKey = 'indigo';
export const CONDUCTOR_DEFAULT: ConductorAccentKey = 'azul-led';

/**
 * Glow decorativo: color vibrante NO apto para texto (fluor neón puro). Vive
 * SOLO en el chip/indicador (glow), nunca lleva texto. El resto del acento usa
 * la rampa (oscurecida) donde va texto.
 */
export const ACCENT_GLOW: Partial<Record<AccentPresetKey, string>> = {
  fluor: '#12F0F0',
};

export const OPERATOR_KEYS = Object.keys(operatorPresets) as OperatorAccentKey[];
export const CONDUCTOR_KEYS = Object.keys(conductorPresets) as ConductorAccentKey[];

/** Metadata por paleta: qué presets muestra cada rol y su default. */
export const ACCENT_PALETTES: Record<
  AccentPalette,
  { keys: AccentPresetKey[]; default: AccentPresetKey; presets: Record<string, ColorRamp> }
> = {
  operator: { keys: OPERATOR_KEYS, default: OPERATOR_DEFAULT, presets: operatorPresets },
  conductor: { keys: CONDUCTOR_KEYS, default: CONDUCTOR_DEFAULT, presets: conductorPresets },
};
