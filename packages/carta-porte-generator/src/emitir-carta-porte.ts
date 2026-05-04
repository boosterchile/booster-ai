/**
 * Orchestrator: input parseado por Zod → PDF base con placeholder →
 * firma PAdES con KMS → bytes finales. El caller decide qué hacer con
 * los bytes (típicamente persistir vía `@booster-ai/document-indexer`).
 */

import { firmarPades, obtenerOEmitirCertSelfSigned } from '@booster-ai/certificate-generator';
import { generarPdfCartaPorte } from './generar-pdf.js';
import { cartaPorteInputSchema } from './tipos.js';
import type { CartaPorteInput, ConfigInfra, ResultadoEmisionCartaPorte } from './tipos.js';

export interface ParametrosEmitirCartaPorte {
  input: CartaPorteInput;
  infra: ConfigInfra;
}

export async function emitirCartaPorte(
  params: ParametrosEmitirCartaPorte,
): Promise<ResultadoEmisionCartaPorte> {
  // Validación temprana: si falta un campo legal, no llegamos a KMS.
  const validated = cartaPorteInputSchema.parse(params.input);

  const pdfConPlaceholder = await generarPdfCartaPorte(validated);

  // Reuse del cert X.509 self-signed que certificate-generator ya
  // emite para la KMS key. Misma identidad de firma para certs ESG y
  // cartas de porte (es Booster como Software Generator). Si en el
  // futuro queremos identidades distintas, esta función acepta keyId
  // distinto y emite cert separado.
  const cert = await obtenerOEmitirCertSelfSigned({
    certificatesBucket: params.infra.certBucket,
    kmsKeyId: params.infra.kmsKeyId,
  });

  const firma = await firmarPades({
    pdfBytes: pdfConPlaceholder,
    cert,
    kmsKeyId: params.infra.kmsKeyId,
  });

  return {
    pdfFirmado: firma.pdfFirmado,
    pdfSha256: firma.pdfSha256,
    kmsKeyVersion: firma.kmsKeyVersion,
    signingTime: firma.signingTime,
    folio: validated.folio,
  };
}
