import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

/**
 * T10-11 — axe sobre la pantalla actual con las reglas WCAG 2.1 A/AA.
 * Falla si hay alguna violación `serious` o `critical`; las `moderate` y
 * `minor` quedan para la auditoría manual (`docs/audits/wcag-*.md`).
 *
 * El mensaje lista regla, impacto y los primeros selectores afectados para
 * que el fallo se pueda corregir sin abrir el reporte.
 */
export async function expectSinViolacionesGraves(page: Page, pantalla: string): Promise<void> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const graves = resultado.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const resumen = graves.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
  expect(resumen, `axe en ${pantalla}`).toEqual([]);
}
