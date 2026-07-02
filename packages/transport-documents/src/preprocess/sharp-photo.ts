/**
 * Adapter de preprocesamiento de FOTOS con `sharp` (binario prebuilt npm, NO
 * apt-get/libvips compilado a mano — C-8 / O-2). Normaliza una foto del
 * documento (rotación EXIF, escala de grises, contraste) y la entrega como RGBA
 * para que `zxing-wasm` tenga más chance de leer el PDF417 del timbre.
 *
 * `sharp` se usa SOLO acá (fotos). El render de PDF (crítico) es WASM puro
 * (pdfium). Excluido del coverage de unidad (vitest.config): adapter de I/O.
 */

import sharp from 'sharp';
import type { PhotoPreprocessor, RasterImage } from '../ports.js';

export function createSharpPhotoPreprocessor(): PhotoPreprocessor {
  return {
    async toImage(photo: Uint8Array): Promise<RasterImage> {
      const { data, info } = await sharp(photo)
        // rotate() sin argumento aplica la orientación EXIF (fotos de celular).
        .rotate()
        // Escala de grises + normalización de contraste ayudan al binarizador
        // de zxing en fotos con iluminación irregular.
        .grayscale()
        .normalize()
        // RGBA: zxing espera 4 canales (ImageData-like).
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      return {
        data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
        width: info.width,
        height: info.height,
      };
    },
  };
}
