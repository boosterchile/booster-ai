/**
 * @booster-ai/certificate-generator
 *
 * Genera y firma digitalmente certificados de huella de carbono según
 * GLEC v3.0. Ver README.md para arquitectura y validación externa.
 *
 * API pública:
 *
 *   import { emitirCertificado } from '@booster-ai/certificate-generator';
 *
 *   const resultado = await emitirCertificado({
 *     viaje, metricas, empresaShipper, transportista, infra,
 *     verifyBaseUrl: 'https://api.boosterchile.com',
 *   });
 *
 *   // resultado.pdfGcsUri, .sigGcsUri, .pdfSha256, .kmsKeyVersion
 */

export { emitirCertificado, type ParametrosEmisionCertificado } from './emitir-certificado.js';
export { generarPdfBase } from './generar-pdf-base.js';
export { firmarPades } from './firmar-pades.js';
export { obtenerOEmitirCertSelfSigned } from './ca-self-signed.js';
export { esBucketLocal, esKeyLocal } from './backend-local.js';
export {
  subirArtefactosCertificado,
  generarSignedUrlPdf,
  descargarSidecar,
  ArtefactoYaSubidoError,
  rutaPdfCertificado,
  versionDePdf,
} from './storage.js';

export type {
  DatosViajeCertificado,
  DatosMetricasCertificado,
  DatosEmpresaCertificado,
  DatosTransportistaCertificado,
  ConfigInfra,
  ResultadoEmisionCertificado,
  SidecarFirma,
} from './tipos.js';
export {
  MOTIVOS_REEMISION,
  type MotivoReemision,
  TEXTO_MOTIVO_REEMISION,
  type VersionCertificado,
} from './reemision.js';

// ADR-091: la presentación del certificado, para quien la muestre fuera del PDF.
export { type Presentacion, presentacionNivel } from './render-helpers.js';

export {
  type ConsolidacionCertificado,
  FRASE_CONSOLIDACION,
  TEXTO_METODO_REPARTO,
  validarConsolidacion,
} from './consolidacion.js';
