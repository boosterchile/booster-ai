import { expect, test } from '@playwright/test';

/**
 * Modal (react-aria-components) verificado en browser real — foco y portal no
 * son computables en jsdom. Cada test FALLA si se rompe el comportamiento que
 * verifica (trap, retorno de foco, re-aplicación del registro), no es un assert
 * que pasa siempre. Los modales viven en /apariencia (dentro del RegisterProvider
 * con el toggle de registro).
 */
test.describe('Modal en Chromium', () => {
  test('abre, atrapa el foco, Esc cierra y RETORNA el foco al trigger', async ({ page }) => {
    await page.goto('/apariencia');
    const trigger = page.getByTestId('open-modal');
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Detalle de la carga' });
    await expect(dialog).toBeVisible();

    // Foco atrapado DENTRO del modal (RAC autoFocus + FocusScope).
    const focusInside = await page.evaluate(
      () => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
    );
    expect(focusInside).toBe(true);

    // Esc cierra SIEMPRE y retorna el foco al trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('el portal RE-APLICA el registro: bajo conductor el modal usa padding conductor (14px)', async ({
    page,
  }) => {
    await page.goto('/apariencia');
    await page.getByTestId('register-toggle-conductor').click();
    await page.getByTestId('open-modal').click();

    const box = page.getByTestId('demo-modal');
    await expect(box).toBeVisible();
    // conductor comoda --pad-y = 0.875rem = 14px. Sin re-aplicar el registro en
    // el portal, caería al default operador (8px) — bug que este test atrapa.
    await expect(box).toHaveCSS('padding-top', '14px');
  });

  test('el modal operador (default) usa padding operador (8px)', async ({ page }) => {
    await page.goto('/apariencia');
    await page.getByTestId('open-modal').click();
    const box = page.getByTestId('demo-modal');
    await expect(box).toBeVisible();
    await expect(box).toHaveCSS('padding-top', '8px');
  });

  test('click-afuera configurable: dismissable cierra; destructivo NO (solo Esc/botones)', async ({
    page,
  }) => {
    await page.goto('/apariencia');

    // Default dismissable=true: click en el backdrop (esquina) cierra.
    await page.getByTestId('open-modal').click();
    await expect(page.getByTestId('demo-modal')).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(page.getByTestId('demo-modal')).toBeHidden();

    // Destructivo isDismissable=false: click afuera NO cierra; Esc sí.
    await page.getByTestId('open-confirm').click();
    await expect(page.getByTestId('demo-confirm')).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(page.getByTestId('demo-confirm')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('demo-confirm')).toBeHidden();
  });

  test('scroll-lock: el fondo no scrollea con el modal abierto', async ({ page }) => {
    await page.goto('/apariencia');
    await page.getByTestId('open-modal').click();
    await expect(page.getByTestId('demo-modal')).toBeVisible();
    const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
    expect(overflow).toBe('hidden');
  });
});
