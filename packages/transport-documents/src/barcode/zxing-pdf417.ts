/**
 * Adapter de decodificación PDF417 con `zxing-wasm` (WASM puro — C-8). Lee el
 * primer símbolo PDF417 de una imagen RGBA rasterizada (el timbre del DTE).
 *
 * Excluido del coverage de unidad (vitest.config): adapter de I/O sobre WASM;
 * la orquestación se testea con dobles del puerto `Pdf417Decoder`.
 */

import { readBarcodes } from 'zxing-wasm/reader';
import type { Pdf417Decoder, RasterImage } from '../ports.js';

export function createZxingPdf417Decoder(): Pdf417Decoder {
  return {
    async decode(image: RasterImage): Promise<string | null> {
      const results = await readBarcodes(
        { data: image.data, width: image.width, height: image.height },
        {
          formats: ['PDF417'],
          // tryHarder/tryRotate ON por defecto: el timbre puede venir rotado en
          // una foto. Optimizamos acierto sobre velocidad (corre en el worker).
          tryHarder: true,
          tryRotate: true,
        },
      );
      const valid = results.find((r) => r.isValid && r.text.length > 0);
      return valid ? valid.text : null;
    },
  };
}
