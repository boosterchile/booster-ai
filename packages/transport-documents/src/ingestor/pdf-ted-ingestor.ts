/**
 * `PdfTedIngestor` — ingestor principal del frente F4-4b.
 *
 * Decodifica el TED (PDF417) de un documento tributario de tercero,
 * best-effort:
 *
 *   1. Re-detecta el tipo real del buffer (PDF vs foto) por magic bytes.
 *   2. PDF  → rasteriza cada página a imagen (pdfium WASM).
 *      Foto → preprocesa con sharp (grises/contraste).
 *   3. Decodifica el primer PDF417 legible (zxing-wasm) en cada imagen.
 *   4. Parsea el XML del <TED> y mapea el <DD> a las columnas (gate C-7).
 *   5. Calcula `retention_until` (fecha_emision+6a, fallback created_at+6a).
 *
 * Tolerante a fallo (gate C-7 §7): cualquier paso que no produzca un TED
 * parseable → `fallido` (el documento se conserva; el cierre de orden no se
 * bloquea). Nunca lanza: los errores de los adapters WASM se capturan y se
 * traducen a `fallido`.
 *
 * La verificación criptográfica de <FRMT> está FUERA de alcance (C-7 §6).
 *
 * Los adapters de I/O (render PDF, decode PDF417, preprocess foto) se inyectan
 * como puertos: la orquestación es pura y testeable con dobles (C-4).
 */

import { detectFileKind } from '../detect/detect-file-kind.js';
import type { Pdf417Decoder, PhotoPreprocessor, RasterImage, RasterRenderer } from '../ports.js';
import { calcularRetentionUntil } from '../retention/calcular-retention-until.js';
import { parseTedDd } from '../ted/parse-ted-dd.js';
import type { DocumentIngestor, IngestInput, IngestResult } from './document-ingestor.js';

export interface PdfTedIngestorPorts {
  renderer: RasterRenderer;
  decoder: Pdf417Decoder;
  preprocessor: PhotoPreprocessor;
}

export class PdfTedIngestor implements DocumentIngestor {
  private readonly renderer: RasterRenderer;
  private readonly decoder: Pdf417Decoder;
  private readonly preprocessor: PhotoPreprocessor;

  constructor(ports: PdfTedIngestorPorts) {
    this.renderer = ports.renderer;
    this.decoder = ports.decoder;
    this.preprocessor = ports.preprocessor;
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const images = await this.toImages(input.buffer);
    if (images === null) {
      return { status: 'fallido', reason: 'unsupported_or_corrupt_file' };
    }

    const tedXml = await this.firstDecodablePdf417(images);
    if (tedXml === null) {
      return { status: 'fallido', reason: 'no_pdf417_found' };
    }

    const parsed = parseTedDd(tedXml);
    if (!parsed.ok) {
      return { status: 'fallido', reason: `ted_parse_${parsed.reason}` };
    }

    const retention = calcularRetentionUntil({
      fechaEmision: parsed.fields.fechaEmision,
      createdAt: input.createdAt,
    });

    return {
      status: 'decodificado',
      fields: parsed.fields,
      tedRaw: parsed.tedRaw,
      retentionUntil: retention.retentionUntil,
      needsRetentionReview: retention.needsReview,
    };
  }

  /**
   * Rasteriza/preprocesa el buffer a imágenes según su tipo real. Devuelve
   * `null` (→ fallido) si el tipo no es soportado o el adapter WASM lanza
   * (PDF corrupto, foto ilegible para el rasterizador, etc.).
   */
  private async toImages(buffer: Uint8Array): Promise<RasterImage[] | null> {
    const kind = detectFileKind(buffer);
    try {
      if (kind === 'pdf') {
        return await this.renderer.renderPdfPages(buffer);
      }
      if (kind === 'photo') {
        return [await this.preprocessor.toImage(buffer)];
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Devuelve el contenido del primer PDF417 decodificable, o null. */
  private async firstDecodablePdf417(images: RasterImage[]): Promise<string | null> {
    for (const image of images) {
      let decoded: string | null;
      try {
        decoded = await this.decoder.decode(image);
      } catch {
        decoded = null;
      }
      if (decoded !== null && decoded.trim().length > 0) {
        return decoded;
      }
    }
    return null;
  }
}
