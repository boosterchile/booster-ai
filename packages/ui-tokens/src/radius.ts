/**
 * Border radius. Booster usa esquinas suaves pero NO pill por default.
 * Buttons + inputs: md (8px). Cards: lg (12px). Modals: xl (16px).
 * Pill (full) reservado para tags, badges, avatars circulares.
 */
export const radius = {
  none: '0px',
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '24px',
  '3xl': '32px',
  full: '9999px',
} as const;

export type Radius = typeof radius;
