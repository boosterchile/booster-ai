import { PDFDocument } from 'pdf-lib';
import { beforeAll, vi } from 'vitest';
import { embeberFuentes } from '../src/fuentes.js';

/**
 * Límite por test en las suites que generan PDF. En CI, bajo coverage y con
 * 31 paquetes en paralelo, el test más lento (el primer caso de
 * `margenes.test.ts`, que además revisa el PDF con pdfjs) tardó entre 12 y
 * 26 s en tres corridas de `main` del 2026-11-18, y 30,3 s en una del
 * 2026-11-03, que falló contra el límite anterior de 30 s. Local sin
 * coverage: p50 146 ms. El límite deja tres veces el peor caso medido.
 */
export const LIMITE_TEST_PDF_MS = 90_000;

/**
 * Suites que generan PDF: precalientan fontkit y las fuentes (lectura de
 * bytes, parseo, JIT) una vez por archivo y suben el timeout SOLO aquí. El
 * resto del paquete queda en 5 s.
 */
export function suitePdf(): void {
  vi.setConfig({ testTimeout: LIMITE_TEST_PDF_MS });
  beforeAll(async () => {
    await embeberFuentes(await PDFDocument.create());
  }, LIMITE_TEST_PDF_MS);
}
