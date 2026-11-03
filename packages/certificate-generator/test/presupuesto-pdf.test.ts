/**
 * HC-004 — presupuesto de rendimiento: p50 de generar un certificado < 1 s,
 * local y SIN coverage (la instrumentación multiplica ×10–×80 el tiempo). Es
 * opt-in: sólo corre con PDF_PRESUPUESTO=1 y nunca en CI:
 *   PDF_PRESUPUESTO=1 pnpm --filter @booster-ai/certificate-generator test:presupuesto
 */
import { describe, expect, it } from 'vitest';
import { generarPdfBase } from '../src/generar-pdf-base.js';
import { CASOS } from './casos-pdf.js';
import { suitePdf } from './pdf-suite.js';

const activo = process.env.PDF_PRESUPUESTO === '1' && !process.env.CI;
suitePdf();

describe.skipIf(!activo)('presupuesto PDF (local, sin coverage)', () => {
  it('p50 de 15 generaciones < 1000 ms en cada caso', async () => {
    for (const [nombre, params] of Object.entries(CASOS)) {
      const ms: number[] = [];
      for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        await generarPdfBase(params);
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      const p50 = ms[7] ?? Number.POSITIVE_INFINITY;
      console.info(
        `[presupuesto] ${nombre}: p50=${p50.toFixed(0)} ms máx=${ms[14]?.toFixed(0)} ms`,
      );
      expect(p50, nombre).toBeLessThan(1000);
    }
  });
});
