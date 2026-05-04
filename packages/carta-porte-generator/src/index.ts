/**
 * @booster-ai/carta-porte-generator
 *
 * Genera Cartas de Porte Ley 18.290 Art. 174 firmadas con PAdES
 * (KMS RSA-PKCS1-4096-SHA256). El caller persiste los bytes resultantes
 * vía `@booster-ai/document-indexer` con type='carta_porte'.
 *
 * API pública:
 *
 *   import { emitirCartaPorte } from '@booster-ai/carta-porte-generator';
 *
 *   const { pdfFirmado, pdfSha256, kmsKeyVersion } = await emitirCartaPorte({
 *     input: { folio, emittedAt, porteador, cargador, ... },
 *     infra: { kmsKeyId, certBucket },
 *   });
 *
 *   // Persistir vía document-indexer:
 *   await indexer.upload({
 *     empresaId, tripId, type: 'carta_porte',
 *     body: pdfFirmado, mimeType: 'application/pdf',
 *     sha256: pdfSha256, ...
 *   });
 */

export { emitirCartaPorte } from './emitir-carta-porte.js';
export type { ParametrosEmitirCartaPorte } from './emitir-carta-porte.js';
export { generarPdfCartaPorte } from './generar-pdf.js';
export {
  cartaPorteInputSchema,
  type CartaPorteInput,
  type ConfigInfra,
  type ResultadoEmisionCartaPorte,
} from './tipos.js';
