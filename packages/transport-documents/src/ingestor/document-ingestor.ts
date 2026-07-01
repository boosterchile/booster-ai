/**
 * Contrato común de los ingestores de documentos de transporte (frente F4).
 *
 *   - `PdfTedIngestor` (4b): decodifica el TED PDF417 de un PDF o foto.
 *   - `XmlIntercambioIngestor` (4c, stub): recepción por el canal de
 *     Intercambio entre Contribuyentes (EnvioDTE). No implementado en 4b.
 *
 * Cada implementación recibe un buffer crudo (descargado de GCS) y el
 * `createdAt` de la fila para el fallback de retención, y devuelve un
 * `IngestResult` que el worker persiste en `documentos_transporte`.
 */

import type { TedFields } from '../ted/parse-ted-dd.js';

export interface IngestInput {
  /** Bytes crudos del archivo (PDF o foto) descargado de GCS. */
  buffer: Uint8Array;
  /** `creado_en` de la fila — insumo del fallback de `retention_until`. */
  createdAt: Date;
}

/**
 * Resultado de la ingesta. `decodificado` trae los campos del `<DD>` + el TED
 * crudo + la retención; `fallido` solo el motivo (el documento se conserva, el
 * cierre de orden NO se bloquea — `REQUIRE_TED_DECODE=false`).
 */
export type IngestResult =
  | {
      status: 'decodificado';
      fields: TedFields;
      tedRaw: string;
      /** ISO date YYYY-MM-DD calculada (fecha_emision+6a o fallback). */
      retentionUntil: string;
      /** true si se usó el fallback created_at+6a (revisar el plazo). */
      needsRetentionReview: boolean;
    }
  | {
      status: 'fallido';
      /** Motivo legible para observabilidad (no PII). */
      reason: string;
    };

export interface DocumentIngestor {
  ingest(input: IngestInput): Promise<IngestResult>;
}
