import { PDFDocument } from 'pdf-lib';
import { beforeAll, vi } from 'vitest';
import { embeberFuentes } from '../src/fuentes.js';

/**
 * Suites que generan PDF: precalientan fontkit y las fuentes (lectura de
 * bytes, parseo, JIT) una vez por archivo y suben el timeout SOLO aquí. Bajo
 * coverage con 31 paquetes en paralelo, un PDF llegó a 12,4 s en CI (local
 * sin coverage: p50 146 ms). El resto del paquete queda en 5 s.
 */
export function suitePdf(): void {
  vi.setConfig({ testTimeout: 30_000 });
  beforeAll(async () => {
    await embeberFuentes(await PDFDocument.create());
  }, 30_000);
}
