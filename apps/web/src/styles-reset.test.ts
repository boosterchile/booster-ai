import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Blindaje de la regresión #576.
 *
 * El reset de form-controls (`color: inherit`) DEBE vivir dentro de `@layer
 * base`: en Tailwind 4 una regla sin capa gana sobre `@layer utilities`, así que
 * un reset sin capa pisaría `text-white` en los botones de acento y el texto
 * computaría oscuro/negro — ilegible sobre el fill (#576). Dentro de `@layer
 * base`, las utilities de texto vuelven a ganar.
 *
 * jsdom no soporta cascade layers ni aplica el CSS generado por Tailwind, así
 * que "text-white computa blanco" no es computable en unidad (y no traemos
 * Playwright). Se blinda en dos mitades: (1) acá, que el reset siga en `@layer
 * base`; (2) en `ui-components/button.test`, que el Button aplique `text-white`.
 */
describe('styles.css — blindaje regresión #576 (reset en @layer base)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(here, 'styles.css'), 'utf8');

  it('el reset de button vive dentro de @layer base con color: inherit', () => {
    const layerBase = css.match(/@layer base\s*\{[\s\S]*?\}\s*\}/);
    expect(layerBase, 'debe existir un bloque @layer base').not.toBeNull();
    const block = layerBase?.[0] ?? '';
    expect(block).toContain('button');
    expect(block).toContain('color: inherit');
  });
});
