/**
 * Puertos (interfaces de I/O) que el orquestador `PdfTedIngestor` consume.
 * Aislar el render WASM (pdfium), la decodificación PDF417 (zxing-wasm) y el
 * preprocesamiento de fotos (sharp) detrás de interfaces permite testear la
 * orquestación con dobles, sin binarios WASM ni PDFs reales (C-4: lógica pura
 * y testeable; los adapters concretos viven aparte y quedan fuera del coverage
 * de unidad).
 */

/**
 * Imagen rasterizada en memoria. Forma compatible con el `ImageData` que
 * `zxing-wasm` acepta como input: RGBA de 8 bits, fila por fila.
 */
export interface RasterImage {
  /** Pixeles RGBA (4 bytes por pixel), `width * height * 4` bytes. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Rasteriza un PDF (todas sus páginas) a imágenes en memoria. */
export interface RasterRenderer {
  renderPdfPages(pdf: Uint8Array): Promise<RasterImage[]>;
}

/** Decodifica el primer símbolo PDF417 de una imagen; null si no hay ninguno. */
export interface Pdf417Decoder {
  decode(image: RasterImage): Promise<string | null>;
}

/** Preprocesa una foto (grises/contraste/normalización) a imagen rasterizada. */
export interface PhotoPreprocessor {
  toImage(photo: Uint8Array): Promise<RasterImage>;
}
