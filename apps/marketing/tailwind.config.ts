import { colors, fontFamily, fontSize, radius, shadow, spacing } from '@booster-ai/ui-tokens';
import type { Config } from 'tailwindcss';

/**
 * Tailwind config de apps/marketing. Consume los design tokens compartidos
 * (@booster-ai/ui-tokens) para mantener la misma marca que apps/web.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      fontFamily,
      fontSize,
      borderRadius: radius,
      boxShadow: shadow,
      spacing,
    },
  },
};

export default config;
