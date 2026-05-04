/**
 * Integration test del BsaleAdapter contra el sandbox real de Bsale + SII
 * certification (https://maullin.sii.cl).
 *
 * **NO corre en CI por default** — requiere credenciales sandbox que solo
 * existen en máquinas con acceso a las cuentas Bsale + cert digital del
 * emisor de prueba. El test se skipea si las env vars necesarias no están.
 *
 * Cuándo correr:
 *   - Antes de mergear PR del BsaleAdapter (#29) a main para validar que
 *     el field mapping de `bsale.ts` matchea la API real.
 *   - Cuando la spec de Bsale cambie (anuncian breaking change, etc.).
 *   - Antes de promover a producción (con cert SII real).
 *
 * Cómo correr (en máquina con acceso):
 *   ```bash
 *   export BSALE_API_TOKEN=<sandbox-token>
 *   export BSALE_TEST_RUT_EMISOR=<rut-emisor-sandbox>     # ej. 76123456-7
 *   export BSALE_TEST_RUT_RECEPTOR=<rut-receptor>          # ej. 12345678-9
 *   export BSALE_TEST_RUN_INTEGRATION=true
 *   pnpm --filter @booster-ai/dte-provider test bsale.integration
 *   ```
 *
 * Si BSALE_TEST_RUN_INTEGRATION no está seteada, vitest reporta "skipped"
 * sin failure — útil para que el dev local NO accidentalmente emita DTEs
 * contra SII al correr el test suite completo.
 *
 * El test emite UN folio en sandbox SII por corrida — barato, no produce
 * efectos legales reales (es ambiente certification).
 *
 * Runbook detallado: docs/runbooks/dte-bsale-validation.md
 */

import { describe, expect, it } from 'vitest';
import { BsaleAdapter, type GuiaDespachoInput } from '../src/index.js';

const RUN_INTEGRATION = process.env.BSALE_TEST_RUN_INTEGRATION === 'true';
const apiToken = process.env.BSALE_API_TOKEN;
const rutEmisor = process.env.BSALE_TEST_RUT_EMISOR;
const rutReceptor = process.env.BSALE_TEST_RUT_RECEPTOR;

const skipMessage =
  '⏭️  Skipped — requiere BSALE_TEST_RUN_INTEGRATION=true + BSALE_API_TOKEN + BSALE_TEST_RUT_EMISOR + BSALE_TEST_RUT_RECEPTOR. Ver docs/runbooks/dte-bsale-validation.md';

describe.skipIf(!RUN_INTEGRATION || !apiToken || !rutEmisor || !rutReceptor)(
  'BsaleAdapter — integration test (sandbox SII)',
  () => {
    it.skipIf(!apiToken)(skipMessage, () => {
      // Placeholder para que el "describe" tenga al menos un it cuando
      // skipea — Vitest reporta el skip más limpio.
    });

    it('emitGuiaDespacho contra sandbox real → folio asignado por SII', async () => {
      const adapter = new BsaleAdapter({
        // biome-ignore lint/style/noNonNullAssertion: validated by skipIf above
        apiToken: apiToken!,
        environment: 'certification',
      });

      const input: GuiaDespachoInput = {
        // biome-ignore lint/style/noNonNullAssertion: validated by skipIf above
        rutEmisor: rutEmisor!,
        razonSocialEmisor: 'Booster AI Sandbox Emisor',
        // biome-ignore lint/style/noNonNullAssertion: validated by skipIf above
        rutReceptor: rutReceptor!,
        razonSocialReceptor: 'Booster AI Sandbox Receptor',
        fechaEmision: new Date(),
        items: [
          {
            descripcion: `Test integration ${new Date().toISOString()}`,
            cantidad: 1,
            precioUnitarioClp: 10_000,
            unidadMedida: 'VIAJE',
          },
        ],
        transporte: {
          rutChofer: '11111111-1',
          nombreChofer: 'Chofer de Prueba',
          patente: 'AB-CD-12',
          direccionDestino: 'Calle Test 123',
          comunaDestino: 'Santiago',
        },
        tipoDespacho: 5,
        referenciaExterna: `BOO-INT-${Date.now()}`,
      };

      const result = await adapter.emitGuiaDespacho(input);

      expect(result.folio).toMatch(/^\d+$/);
      expect(result.tipoDte).toBe(52);
      expect(result.rutEmisor).toBe(input.rutEmisor);
      expect(['accepted', 'pending_sii_validation']).toContain(result.status);

      // Si Bsale ya devolvió XML firmado, el sha256 debe ser hex válido.
      if (result.xmlSigned && result.xmlSigned.length > 0) {
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      } else {
        // Algunas configuraciones de Bsale entregan el XML asíncrono —
        // el caller debería poll-ear queryStatus + GET separado.
        expect(result.sha256).toBe('pending');
      }

      // Esperar a que SII responda (hasta 10s en sandbox)
      await new Promise((r) => setTimeout(r, 5000));

      const status = await adapter.queryStatus({
        folio: result.folio,
        // biome-ignore lint/style/noNonNullAssertion: validated by skipIf above
        rutEmisor: rutEmisor!,
        tipoDte: 52,
      });
      expect(status.folio).toBe(result.folio);
      expect(['accepted', 'pending_sii_validation', 'rejected']).toContain(status.status);
      // En sandbox SII, "rejected" puede ser legítimo si el RUT no está
      // inscrito o glosa rara. El test no afirma "accepted" estricto —
      // afirma que hay una respuesta válida del flow completo.
    }, 30_000); // timeout 30s — Bsale + SII pueden tardar
  },
);
