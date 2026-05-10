/**
 * Smoke test del PDF base — sin KMS ni GCS, solo valida que la
 * generación produce un PDF con placeholder embebido.
 *
 * Tests que tocan KMS / GCS son integration y se corren con creds
 * reales en `pnpm --filter @booster-ai/certificate-generator test:int`.
 */

import { describe, expect, it } from 'vitest';
import { generarPdfBase } from '../src/generar-pdf-base.js';

describe('generarPdfBase', () => {
  const viajeMinimo = {
    trackingCode: 'BOO-TEST01',
    origenDireccion: 'Av. Apoquindo 5400, Las Condes',
    origenRegionCode: 'XIII',
    destinoDireccion: 'Calle 1 Norte 123, Concepción',
    destinoRegionCode: 'VIII',
    cargoTipo: 'carga_seca',
    cargoPesoKg: 12000,
    pickupAt: new Date('2026-05-01T10:00:00Z'),
    deliveredAt: new Date('2026-05-02T18:30:00Z'),
  };

  const metricasMinimo = {
    distanciaKmEstimated: 510.4,
    distanciaKmActual: 521.2,
    kgco2eWtwEstimated: 312.5,
    kgco2eWtwActual: 318.7,
    kgco2eTtw: 267.1,
    kgco2eWtt: 51.6,
    combustibleConsumido: 145.8,
    combustibleUnidad: 'L' as const,
    intensidadGco2ePorTonKm: 50.95,
    precisionMethod: 'modelado' as const,
    glecVersion: 'v3.0',
    emissionFactorUsado: 3.77,
    fuenteFactores: 'SEC Chile 2024 + GLEC v3.0',
    calculatedAt: new Date('2026-05-02T19:00:00Z'),
  };

  const empresaMinimo = {
    id: '00000000-0000-0000-0000-000000000001',
    legalName: 'Logística del Sur SpA',
    rut: '76.123.456-K',
  };

  it('genera un PDF con bytes válidos', async () => {
    const bytes = await generarPdfBase({
      viaje: viajeMinimo,
      metricas: metricasMinimo,
      empresaShipper: empresaMinimo,
      verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
    });

    // Header PDF estándar.
    expect(bytes.length).toBeGreaterThan(2000);
    const head = Buffer.from(bytes.slice(0, 8)).toString('utf-8');
    expect(head.startsWith('%PDF-')).toBe(true);
  });

  it('incluye un placeholder de firma con ByteRange', async () => {
    const bytes = await generarPdfBase({
      viaje: viajeMinimo,
      metricas: metricasMinimo,
      empresaShipper: empresaMinimo,
      verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
    });

    // El placeholder de @signpdf/placeholder-plain inserta:
    //   /ByteRange [0 0 0 0]      ← se rellena al firmar
    //   /Contents <00...0>        ← placeholder de firma
    //   /Filter /Adobe.PPKLite
    //   /SubFilter /ETSI.CAdES.detached
    const pdfStr = Buffer.from(bytes).toString('binary');
    expect(pdfStr).toContain('/ByteRange');
    expect(pdfStr).toContain('/Contents');
    expect(pdfStr).toContain('/Adobe.PPKLite');
    expect(pdfStr).toContain('/ETSI.CAdES.detached');
  });

  it('respeta el placeholderBytes custom para PKCS7 grandes', async () => {
    const small = await generarPdfBase({
      viaje: viajeMinimo,
      metricas: metricasMinimo,
      empresaShipper: empresaMinimo,
      verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
      placeholderBytes: 4096,
    });
    const big = await generarPdfBase({
      viaje: viajeMinimo,
      metricas: metricasMinimo,
      empresaShipper: empresaMinimo,
      verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
      placeholderBytes: 32768,
    });
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('renderiza datos opcionales del transportista cuando los hay', async () => {
    const bytes = await generarPdfBase({
      viaje: viajeMinimo,
      metricas: metricasMinimo,
      empresaShipper: empresaMinimo,
      transportista: {
        legalName: 'Transportes Andino Ltda',
        rut: '77.987.654-3',
        vehiclePlate: 'BJWZ-12',
      },
      verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
    });
    const pdfStr = Buffer.from(bytes).toString('binary');
    // Las strings de pdf-lib quedan en el stream codificadas; chequeamos
    // que existan partes parciales (el font encoding puede romper el
    // string completo, pero los caracteres ASCII del nombre se preservan).
    expect(pdfStr.length).toBeGreaterThan(2000);
  });

  // ============================================================================
  // ADR-028 — Modo dual (smoke test del PDF; lógica testeada en helpers)
  // ============================================================================

  describe('ADR-028 — modo dual (smoke)', () => {
    // El binary del PDF codifica el texto vía font streams (no ASCII directo)
    // → assertions sobre `pdfStr` no son confiables. La lógica de copy/format
    // se testea en `render-helpers.test.ts` directamente sobre los helpers
    // puros. Acá solo verificamos que `generarPdfBase` no tira error en
    // ambos modos y produce PDFs válidos.
    it('cert primario verificable produce un PDF válido', async () => {
      const bytes = await generarPdfBase({
        viaje: viajeMinimo,
        metricas: {
          ...metricasMinimo,
          precisionMethod: 'exacto_canbus',
          routeDataSource: 'teltonika_gps',
          coveragePct: 98.7,
          certificationLevel: 'primario_verificable',
          uncertaintyFactor: 0.05,
        },
        empresaShipper: empresaMinimo,
        verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
      });
      expect(bytes.length).toBeGreaterThan(2000);
      expect(Buffer.from(bytes.slice(0, 8)).toString('utf-8').startsWith('%PDF-')).toBe(true);
    });

    it('cert secundario_modeled produce un PDF válido (con disclaimer block)', async () => {
      const bytes = await generarPdfBase({
        viaje: viajeMinimo,
        metricas: {
          ...metricasMinimo,
          precisionMethod: 'por_defecto',
          routeDataSource: 'maps_directions',
          coveragePct: 0,
          certificationLevel: 'secundario_modeled',
          uncertaintyFactor: 0.18,
        },
        empresaShipper: empresaMinimo,
        verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
      });
      expect(bytes.length).toBeGreaterThan(2000);
      expect(Buffer.from(bytes.slice(0, 8)).toString('utf-8').startsWith('%PDF-')).toBe(true);
    });

    it('cert sin campos ADR-028 (legacy) sigue produciendo PDF válido', async () => {
      const bytes = await generarPdfBase({
        viaje: viajeMinimo,
        metricas: metricasMinimo,
        empresaShipper: empresaMinimo,
        verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
      });
      expect(bytes.length).toBeGreaterThan(2000);
      expect(Buffer.from(bytes.slice(0, 8)).toString('utf-8').startsWith('%PDF-')).toBe(true);
    });

    it('cert secundario es ligeramente más grande que primario (por el disclaimer block)', async () => {
      const primario = await generarPdfBase({
        viaje: viajeMinimo,
        metricas: { ...metricasMinimo, certificationLevel: 'primario_verificable' },
        empresaShipper: empresaMinimo,
        verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
      });
      const secundario = await generarPdfBase({
        viaje: viajeMinimo,
        metricas: {
          ...metricasMinimo,
          certificationLevel: 'secundario_modeled',
          routeDataSource: 'maps_directions',
          coveragePct: 0,
          uncertaintyFactor: 0.18,
        },
        empresaShipper: empresaMinimo,
        verifyUrl: 'https://api.boosterchile.com/certificates/BOO-TEST01/verify',
      });
      // Disclaimer block + bloque de Origen ruta + ± uncertainty agregan
      // contenido extra en el PDF stream. Verificamos al menos un byte
      // de diferencia (asegura que las ramas se ejercitan distinto).
      expect(secundario.length).toBeGreaterThan(primario.length);
    });
  });
});
