import { expect, test } from '@playwright/test';
import { expectEnRegionViva, revisarPantalla } from './a11y.js';
import {
  CREDENCIAL_T2,
  PIN_ACTIVACION_T2,
  activarConductor,
  loginRutClave,
  reseedConductorE2e,
} from './helpers.js';

/**
 * Flujo conductor punta a punta (Slot 3 paso 6; T10-02 de ADR-082).
 *
 * Empieza donde empieza un conductor real: su empresa lo dio de alta y le
 * entregó un PIN. Activa, opera el viaje y al final vuelve a entrar con la
 * clave que eligió, que es su única credencial.
 *
 * Waits explícitos (`expect` / `waitForURL` / `expect.poll`).
 * Cero `waitForTimeout`. Certificado: se exige emitido. El API del E2E firma
 * con el backend local de `@booster-ai/certificate-generator`
 * (`CERTIFICATE_SIGNING_KEY_ID=local:e2e`, `CERTIFICATES_BUCKET=file:…`), y
 * `/certificates/:tracking/verify` debe devolver la firma (T10-02).
 */
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:8080';
test.use({
  geolocation: { latitude: -33.4372, longitude: -70.6506 },
  permissions: ['geolocation'],
});

test.describe('flujo conductor T2', () => {
  test.beforeEach(() => {
    reseedConductorE2e();
  });

  test('activar → recogida → posición → entrega → certificado → login con su clave', async ({
    page,
    browser,
    request,
  }, testInfo) => {
    // La emisión del certificado es asíncrona y el panel la consulta cada 3 s.
    test.setTimeout(150_000);
    const posiciones: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/driver-position')) {
        posiciones.push(req.url());
      }
    });

    await page.goto('/login/conductor');
    await expect(page.getByRole('heading', { name: 'Activa tu cuenta' })).toBeVisible();
    await revisarPantalla(page, '/login/conductor');
    await activarConductor(page, CREDENCIAL_T2.cond, PIN_ACTIVACION_T2);
    await expect(page).toHaveURL(/\/app\/conductor/, { timeout: 20_000 });

    await expect(page.getByTestId('confirmar-recogida')).toBeVisible();
    await revisarPantalla(page, '/app/conductor (por recoger)');

    // El origen del seed coincide con el geolocation mock: con permiso
    // granted el reporter arranca en `por_recoger` y manda el primer POST
    // (también habilita el body `picked_up_at` del geofence).
    await expect
      .poll(() => posiciones.length, {
        timeout: 25_000,
        message: 'esperaba ≥1 POST /driver-position antes de confirmar recogida',
      })
      .toBeGreaterThan(0);

    await page.getByTestId('confirmar-recogida').click();
    // T10-11: el diálogo inline de confirmación también se recorre con
    // teclado, con foco visible y sin desborde a 320 px.
    await expect(page.getByTestId('confirmacion-inline')).toBeVisible();
    await revisarPantalla(page, '/app/conductor (confirmación inline)');
    await page
      .getByTestId('confirmacion-inline')
      .getByRole('button', { name: 'Sí, confirmar' })
      .click();

    await expect(page.getByTestId('confirmar-entrega')).toBeVisible();

    await page.getByTestId('confirmar-entrega').click();
    await page
      .getByTestId('confirmacion-inline')
      .getByRole('button', { name: 'Sí, confirmar' })
      .click();

    await expect(page.getByText('Entrega confirmada. ¡Gracias!')).toBeVisible();
    await expectEnRegionViva(
      page.getByText('Entrega confirmada. ¡Gracias!'),
      '/app/conductor (entrega confirmada)',
    );
    const resultado = page.getByTestId('resultado-viaje');
    await expect(resultado).toBeVisible();
    await expect(resultado).toContainText('kg CO2e', { timeout: 30_000 });

    // Certificado emitido: el panel cambia «Certificado en proceso» por la
    // descarga cuando la API ya tiene `certificado_emitido_en`.
    await expect(resultado.getByRole('button', { name: 'Descargar certificado' })).toBeVisible({
      timeout: 75_000,
    });
    await revisarPantalla(page, '/app/conductor (entregado)');
    const encabezado = await resultado.getByText(/^Resultado del viaje /).innerText();
    const tracking = encabezado.replace('Resultado del viaje ', '').trim();
    expect(tracking).toMatch(/^E2E[A-Z0-9]+$/);

    const verify = await request.get(`${API_URL}/certificates/${tracking}/verify`);
    expect(verify.status()).toBe(200);
    const firma = (await verify.json()) as Record<string, unknown>;
    expect(firma).toMatchObject({ valid: true, tracking_code: tracking, kms_key_id: 'local:e2e' });
    expect(String(firma.pdf_sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(firma.cert_pem)).toContain('BEGIN CERTIFICATE');

    // La credencial es la clave elegida, no el PIN: sesión nueva, login principal.
    const otraSesion = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const pagina = await otraSesion.newPage();
      await loginRutClave(pagina, CREDENCIAL_T2.cond);
      await expect(pagina).toHaveURL(/\/app\/conductor/, { timeout: 20_000 });
    } finally {
      await otraSesion.close();
    }
  });
});
