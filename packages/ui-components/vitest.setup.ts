import { expect } from 'vitest';
import { toHaveNoViolations } from 'vitest-axe/matchers';

// a11y real: el matcher de vitest-axe corre axe-core sobre el DOM renderizado
// (jsdom). Reemplaza el axe-core "fantasma" que nunca corría (DESIGN.md,
// "Accesibilidad — nominal, no efectiva"). Integrado al `test`/`test:coverage`.
expect.extend({ toHaveNoViolations });
