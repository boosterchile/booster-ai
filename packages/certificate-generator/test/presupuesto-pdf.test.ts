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

const N = 9;

describe.skipIf(!activo)('presupuesto PDF (local, sin coverage)', () => {
  // Un test por caso: con 5+ casos, un solo test superaba el timeout de 30 s.
  it.each(Object.keys(CASOS))(`caso %s: p50 de ${N} generaciones < 1000 ms`, async (nombre) => {
    const params = CASOS[nombre] as (typeof CASOS)['normal'];
    const ms: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await generarPdfBase(params);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const p50 = ms[Math.floor(N / 2)] ?? Number.POSITIVE_INFINITY;
    console.info(
      `[presupuesto] ${nombre}: p50=${p50.toFixed(0)} ms máx=${ms[N - 1]?.toFixed(0)} ms`,
    );
    expect(p50, nombre).toBeLessThan(1000);
  });
});
