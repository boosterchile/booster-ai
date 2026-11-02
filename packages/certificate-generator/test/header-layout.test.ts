/**
 * HC-004 — el título «Certificado de huella de carbono» (Inter Bold 20 pt) y
 * el sello ESTIMADO caben en la misma línea en A4 (márgenes de 48 pt), como
 * pide ux.md §Estructura 4. Se mide con la fuente real embebida.
 */
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { embeberFuentes } from '../src/fuentes.js';
import { TITULO_CERT } from '../src/render-helpers.js';

describe('header v2 — título + sello en una línea', () => {
  it('título 20 pt + 14 pt + sello (ESTIMADO 9,5 pt, tracking 1,5, padding 8) ≤ ancho útil', async () => {
    const f = await embeberFuentes(await PDFDocument.create());
    const sello = f.bold.widthOfTextAtSize('ESTIMADO', 9.5) + 1.5 * 7 + 16;
    const fin = 48 + f.bold.widthOfTextAtSize(TITULO_CERT, 20) + 14 + sello;
    expect(fin).toBeLessThanOrEqual(595.28 - 48);
  });
});
