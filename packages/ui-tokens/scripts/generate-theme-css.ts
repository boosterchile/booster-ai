/**
 * Genera `packages/ui-tokens/theme.css` desde los tokens TS (fuente única).
 * Correr tras cambiar cualquier token: `pnpm --filter @booster-ai/ui-tokens gen:css`.
 * El drift-guard (`css.test.ts`) falla en CI si el archivo committeado no
 * coincide con regenerar.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderThemeCss } from '../src/css.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'theme.css');
const css = renderThemeCss();
writeFileSync(outPath, css, 'utf8');
console.log(`[ui-tokens] theme.css generado — ${css.length} bytes`);
