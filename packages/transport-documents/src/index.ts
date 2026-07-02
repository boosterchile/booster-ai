/**
 * `@booster-ai/transport-documents` — lógica de dominio del repositorio
 * documental de transporte (frente F4, ADR-070). Decodificación best-effort del
 * TED (PDF417) de documentos tributarios de terceros y cálculo de la política
 * de custodia (`retention_until`).
 *
 * La lógica vive acá (no inline en `apps/document-service` ni en services de
 * `apps/api`) por C-4. El worker (4b) consume `createPdfTedIngestor()`; los
 * endpoints de `apps/api` (4a) consumen `calcularRetentionUntil`.
 */

import { createZxingPdf417Decoder } from './barcode/zxing-pdf417.js';
import { PdfTedIngestor, type PdfTedIngestorPorts } from './ingestor/pdf-ted-ingestor.js';
import { createSharpPhotoPreprocessor } from './preprocess/sharp-photo.js';
import { createPdfiumRenderer } from './raster/pdfium-renderer.js';

export type {
  DocumentIngestor,
  IngestInput,
  IngestResult,
} from './ingestor/document-ingestor.js';
export { PdfTedIngestor } from './ingestor/pdf-ted-ingestor.js';
export type { PdfTedIngestorPorts } from './ingestor/pdf-ted-ingestor.js';
export type { Pdf417Decoder, PhotoPreprocessor, RasterImage, RasterRenderer } from './ports.js';
export { parseTedDd } from './ted/parse-ted-dd.js';
export type { ParseTedResult, TedFields } from './ted/parse-ted-dd.js';
export { detectFileKind } from './detect/detect-file-kind.js';
export type { FileKind } from './detect/detect-file-kind.js';
export {
  calcularRetentionUntil,
  type RetentionResult,
} from './retention/calcular-retention-until.js';

/**
 * Construye el `PdfTedIngestor` de producción con los adapters WASM reales
 * (pdfium para render PDF, zxing para PDF417, sharp para fotos). Permite
 * override de puertos en tests/integración.
 */
export function createPdfTedIngestor(overrides?: Partial<PdfTedIngestorPorts>): PdfTedIngestor {
  return new PdfTedIngestor({
    renderer: overrides?.renderer ?? createPdfiumRenderer(),
    decoder: overrides?.decoder ?? createZxingPdf417Decoder(),
    preprocessor: overrides?.preprocessor ?? createSharpPhotoPreprocessor(),
  });
}
