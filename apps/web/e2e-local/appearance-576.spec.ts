import { expect, test } from '@playwright/test';

/**
 * Blindaje de la regresión #576 en un browser real (Chromium).
 *
 * #576: el reset de form-controls (`color: inherit`) debe vivir en `@layer base`
 * para que las utilities de texto ganen; si no, `color: inherit` pisa
 * `text-white` y el texto del botón de acento computa oscuro/negro — ilegible
 * sobre el fill. jsdom no computa cascada ni `@layer` (por eso en Ola 1 el
 * blindaje quedó a nivel fuente); Chromium sí computa la cascada real.
 *
 * Este test cae si alguien saca el reset de `@layer base` (validado revirtiendo
 * el fix localmente → rojo).
 */
test('el botón de acento en /apariencia computa texto blanco (#576)', async ({ page }) => {
  await page.goto('/apariencia');

  const button = page.getByTestId('accent-preview-button');
  await expect(button).toBeVisible();

  const color = await button.evaluate((el) => getComputedStyle(el).color);
  // Blanco = rgb(255, 255, 255). El bug #576 dejaba este color oscuro (neutral).
  expect(color).toBe('rgb(255, 255, 255)');
});
