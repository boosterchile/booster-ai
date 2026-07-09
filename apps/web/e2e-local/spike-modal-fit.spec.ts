import { expect, test } from '@playwright/test';

/**
 * SPIKE (NO productivo) — gate de encaje de react-aria-components para Modal.
 * Verifica en Chromium real que el styling de RAC juega con nuestros tokens
 * (data-accent / data-register) y documenta el comportamiento del portal.
 * Vive en la rama spike; no se mergea a main.
 *
 * Referencias de color (acento default = indigo/operador):
 *   accent-100 = #DADEF5 = rgb(218, 222, 245)
 *   accent-600 = #3B4496 = rgb(59, 68, 150)
 * Padding por registro (comoda): conductor 0.875rem = 14px · operador 0.5rem = 8px.
 */
test.describe('spike: encaje react-aria + tokens', () => {
  test('un estado de RAC ([data-hovered]) se estiliza con nuestra custom property de acento', async ({
    page,
  }) => {
    await page.goto('/spike/modal-fit');
    const open = page.getByTestId('spike-open');
    await expect(open).toBeVisible();
    await open.hover();
    // RAC agrega [data-hovered]; nuestra regla lo pinta con var(--accent-100).
    await expect(open).toHaveCSS('background-color', 'rgb(218, 222, 245)');
  });

  test('el portal MANTIENE el acento (:root) y PIERDE el registro (wrapper)', async ({ page }) => {
    await page.goto('/spike/modal-fit');
    const open = page.getByTestId('spike-open');
    // El botón vive DENTRO del wrapper register=conductor → padding conductor 14px.
    await expect(open).toHaveCSS('padding-top', '14px');

    await open.click();
    const modal = page.getByTestId('spike-modal');
    await expect(modal).toBeVisible();

    // Acento SÍ reachea el portal (data-accent vive en :root/html) → borde accent-600.
    await expect(modal).toHaveCSS('border-top-color', 'rgb(59, 68, 150)');
    // Registro NO reachea el portal (vive en el wrapper) → cae a :root operador 8px,
    // NO al conductor 14px del wrapper. Dato clave para la parte 2 (re-aplicar registro).
    await expect(modal).toHaveCSS('padding-top', '8px');
  });

  test('RAC atrapa el foco en el modal y lo RETORNA al trigger al cerrar (Esc)', async ({
    page,
  }) => {
    await page.goto('/spike/modal-fit');
    const open = page.getByTestId('spike-open');
    await open.click();
    const modal = page.getByTestId('spike-modal');
    await expect(modal).toBeVisible();

    // Foco entró al modal.
    const focusInModal = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="spike-modal"]');
      return m instanceof HTMLElement && m.contains(document.activeElement);
    });
    expect(focusInModal).toBe(true);

    // Esc cierra y retorna el foco al trigger.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(open).toBeFocused();
  });
});
