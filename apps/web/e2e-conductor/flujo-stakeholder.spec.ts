import { expect, test } from '@playwright/test';
import { expectSinViolacionesGraves } from './a11y.js';
import { CREDENCIAL_F, reseedFlujosE2e } from './flujos.js';
import { loginRutClave } from './helpers.js';

/**
 * T10-10 — el admin de plataforma crea una organización stakeholder e
 * invita a una persona; esa persona activa su cuenta con el código y
 * consulta las zonas. En serie: el código sale del primer paso.
 */
test.describe.configure({ mode: 'serial' });

test.describe('stakeholder: alta por el admin → activación → zonas', () => {
  let codigo = '';

  test.beforeAll(() => {
    reseedFlujosE2e();
  });

  test('el admin crea la organización e invita a una persona', async ({ page }) => {
    await loginRutClave(page, CREDENCIAL_F.admin);
    await page.waitForURL(/\/app\/platform-admin/, { timeout: 20_000 });
    await expectSinViolacionesGraves(page, '/app/platform-admin');

    await page.getByTestId('stakeholders-link').click();
    await page.waitForURL(/\/app\/platform-admin\/stakeholders$/);
    await expect(page.getByRole('heading', { name: 'Organizaciones stakeholder' })).toBeVisible();

    const nombre = `Observatorio E2E ${Date.now()}`;
    await page.getByTestId('stakeholder-org-create-toggle').click();
    const form = page.getByTestId('stakeholder-org-create-form');
    await form.getByLabel('Nombre legal').fill(nombre);
    await form.getByLabel('Tipo').selectOption('observatorio_academico');
    await form.getByLabel('Región ámbito (opcional, ISO 3166-2:CL)').fill('CL-CO');
    await expectSinViolacionesGraves(page, '/app/platform-admin/stakeholders (formulario)');
    await page.getByTestId('stakeholder-org-create-submit').click();

    const fila = page.locator('[data-testid^="stakeholder-org-row-"]').filter({ hasText: nombre });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    const orgId = ((await fila.getAttribute('data-testid')) ?? '').replace(
      'stakeholder-org-row-',
      '',
    );
    expect(orgId).toMatch(/^[0-9a-f-]{36}$/);

    await page.getByTestId(`stakeholder-org-toggle-${orgId}`).click();
    await page.getByTestId(`stakeholder-org-invite-toggle-${orgId}`).click();
    await page.getByTestId(`stakeholder-org-invite-rut-${orgId}`).fill(CREDENCIAL_F.stake.rut);
    await page
      .getByTestId(`stakeholder-org-invite-email-${orgId}`)
      .fill('stakeholder-e2e@boosterchile.invalid');
    await page.getByTestId(`stakeholder-org-invite-name-${orgId}`).fill('Analista Observatorio');
    await page.getByTestId(`stakeholder-org-invite-submit-${orgId}`).click();

    const aviso = page.getByTestId('stakeholder-codigo');
    await expect(aviso).toBeVisible({ timeout: 15_000 });
    codigo = (/(\d{6})/.exec(await aviso.innerText()) ?? [])[1] ?? '';
    expect(codigo).toMatch(/^\d{6}$/);
    await expectSinViolacionesGraves(page, '/app/platform-admin/stakeholders (invitación)');
  });

  test('la persona invitada activa su cuenta y consulta las zonas', async ({ page }) => {
    expect(codigo, 'requiere el código del paso anterior').toMatch(/^\d{6}$/);
    await page.goto('/activar');
    await expect(page.getByRole('heading', { name: 'Activa tu cuenta' })).toBeVisible();
    await expectSinViolacionesGraves(page, '/activar');
    await page.getByLabel('RUT').fill(CREDENCIAL_F.stake.rut);
    await page.getByLabel('Código de activación').fill(codigo);
    await page.getByLabel('Clave numérica').fill(CREDENCIAL_F.stake.clave);
    await page.getByLabel('Repite tu clave').fill(CREDENCIAL_F.stake.clave);
    await page.getByRole('button', { name: 'Activar mi cuenta' }).click();

    await page.waitForURL(/\/app\/stakeholder\/zonas$/, { timeout: 25_000 });
    await expect(page.getByRole('heading', { name: 'Zonas de impacto logístico' })).toBeVisible();
    await expect(page.getByTestId('stakeholder-org-context')).toContainText('Observatorio E2E');
    await expect(page.getByText('Puerto de Coquimbo')).toBeVisible();
    await expectSinViolacionesGraves(page, '/app/stakeholder/zonas');
  });
});
