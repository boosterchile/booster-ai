/**
 * Acento customizable del registro "producto" (DESIGN.md D-3/D-4/D-5).
 *
 * 7 presets, cada uno rampa completa 50→900. El usuario elige uno; cambia en
 * runtime (theming vía CSS vars — ver el codegen `css.ts` + `data-accent`). La
 * base cálida y el primario quedan fijos; SOLO el acento cambia.
 *
 * Identidad FIJADA por el PO (no re-decidir): las 7 familias y el default
 * (Índigo). Ninguna es verde (reservado a ambiental) ni fucsia (comercial), ni
 * colisiona con los semánticos. Los hex EXACTOS los generó y verificó el agente
 * contra WCAG AA — ver `contrast.test.ts` (botón ~600 + blanco ≥ 4.5, tint ~50
 * + texto ~800 ≥ 4.5, en claro y oscuro; nunca negro sobre color).
 *
 * NO editar un hex a mano sin correr el test de contraste: un valor que no pasa
 * rompe el CI a propósito.
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

export type AccentPresetKey =
  | 'indigo'
  | 'oceano'
  | 'terracota'
  | 'ciruela'
  | 'pizarra'
  | 'cobalto'
  | 'berenjena';

/** Etiqueta humana en español (UI con tildes, CLAUDE.md naming). */
export const ACCENT_PRESET_LABEL: Record<AccentPresetKey, string> = {
  indigo: 'Índigo',
  oceano: 'Azul océano',
  terracota: 'Terracota',
  ciruela: 'Ciruela',
  pizarra: 'Pizarra',
  cobalto: 'Cobalto',
  berenjena: 'Berenjena',
};

/** Default fijado por el PO. */
export const DEFAULT_ACCENT: AccentPresetKey = 'indigo';

export const accentPresets: Record<AccentPresetKey, ColorRamp> = {
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
  terracota: {
    50: '#FBF0EB',
    100: '#F4DACD',
    200: '#E7B29D',
    300: '#D6866A',
    400: '#C25F41',
    500: '#A8472B',
    600: '#8C3A24',
    700: '#72311F',
    800: '#5E2A1D',
    900: '#431E15',
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

export const ACCENT_PRESET_KEYS: AccentPresetKey[] = Object.keys(
  accentPresets,
) as AccentPresetKey[];
