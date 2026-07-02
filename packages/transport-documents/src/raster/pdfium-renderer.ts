/**
 * Adapter de rasterización de PDF con `@hyzyla/pdfium` (WASM puro — C-8: sin
 * binarios de sistema vía apt-get). Renderiza cada página del PDF a RGBA en
 * memoria para que `zxing-wasm` busque el PDF417 del timbre.
 *
 * Excluido del coverage de unidad (vitest.config): es un adapter de I/O sobre
 * WASM; la orquestación se testea con dobles del puerto `RasterRenderer`.
 */

import { PDFiumLibrary } from '@hyzyla/pdfium';
import type { RasterImage, RasterRenderer } from '../ports.js';

/**
 * Escala de render. 2.0 ≈ 144 DPI sobre el tamaño de página por defecto: un
 * balance entre resolución suficiente para que zxing lea el PDF417 y memoria
 * acotada en Cloud Run. El timbre del DTE es pequeño; subir esto solo si la
 * tasa de decode lo exige.
 */
const RENDER_SCALE = 2.0;

/**
 * Tope de páginas a rasterizar por documento. El TED PDF417 vive en la 1a
 * página del DTE (a veces la guía tiene 2-3 hojas), nunca al final de un PDF
 * grande. Sin tope, un PDF adversario de cientos de páginas (subido por un
 * tercero) rasterizaría todas a RGBA en memoria → OOM en el worker Cloud Run
 * (memory 1Gi). Cap conservador a 3 páginas: suficiente para encontrar el
 * timbre, acotado en memoria. Configurable vía `PDF_MAX_PAGES` (entero ≥1).
 */
const DEFAULT_MAX_PDF_PAGES = 3;

/**
 * Resuelve el tope de páginas desde el entorno (boundary). Valor inválido
 * (no-entero, ≤0) → default. PURA y testeable sin WASM.
 */
export function resolveMaxPdfPages(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_MAX_PDF_PAGES;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_PDF_PAGES;
}

/**
 * Cuántas páginas rasterizar dado el total del PDF y el tope. PURA: aísla la
 * decisión del cap del adapter WASM para poder testear el límite anti-OOM sin
 * un PDF real ni binarios. `min(pageCount, max)`, nunca negativo.
 */
export function pagesToRender(pageCount: number, maxPages: number): number {
  if (pageCount <= 0) {
    return 0;
  }
  return Math.min(pageCount, maxPages);
}

let libraryPromise: Promise<PDFiumLibrary> | null = null;

/** Singleton de la librería WASM (init es caro; se reusa entre mensajes). */
function getLibrary(): Promise<PDFiumLibrary> {
  if (!libraryPromise) {
    libraryPromise = PDFiumLibrary.init();
  }
  return libraryPromise;
}

/**
 * Convierte el render BGRA de pdfium a RGBA (formato que espera zxing /
 * ImageData). pdfium entrega BGRA: swap de los canales B↔R por pixel.
 */
function bgraToRgba(bgra: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    out[i] = bgra[i + 2] as number; // R ← B
    out[i + 1] = bgra[i + 1] as number; // G
    out[i + 2] = bgra[i] as number; // B ← R
    out[i + 3] = bgra[i + 3] as number; // A
  }
  return out;
}

export function createPdfiumRenderer(opts?: { maxPages?: number }): RasterRenderer {
  const maxPages = opts?.maxPages ?? resolveMaxPdfPages(process.env.PDF_MAX_PAGES);
  return {
    async renderPdfPages(pdf: Uint8Array): Promise<RasterImage[]> {
      const library = await getLibrary();
      const document = await library.loadDocument(pdf);
      try {
        // Tope anti-OOM: NUNCA rasterizamos más de `maxPages`, sin importar
        // cuántas páginas declare el PDF (puede ser adversario de tercero).
        const pageCount = pagesToRender(document.getPageCount(), maxPages);
        const images: RasterImage[] = [];
        for (let i = 0; i < pageCount; i++) {
          const page = document.getPage(i);
          const rendered = await page.render({ scale: RENDER_SCALE, colorSpace: 'BGRA' });
          images.push({
            data: bgraToRgba(rendered.data),
            width: rendered.width,
            height: rendered.height,
          });
        }
        return images;
      } finally {
        document.destroy();
      }
    },
  };
}
