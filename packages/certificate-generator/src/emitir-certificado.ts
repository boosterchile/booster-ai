/**
 * Orquestador top-level: toma datos del viaje + métricas + empresa, y
 * produce un certificado firmado subido a GCS. Es la única función que
 * el caller en apps/api debería usar normalmente.
 *
 * Flujo:
 *   1. Resolver/emitir el cert X.509 self-signed sobre la KMS key (cached).
 *   2. Generar el PDF base con placeholder de firma.
 *   3. Firmar el PDF con PAdES + KMS.
 *   4. Subir PDF + sidecar a GCS.
 *   5. Devolver URIs + sha256 + key version para persistir en DB.
 */

import { obtenerOEmitirCertSelfSigned } from './ca-self-signed.js';
import { firmarPades } from './firmar-pades.js';
import { generarPdfBase } from './generar-pdf-base.js';
import { subirArtefactosCertificado } from './storage.js';
import type {
  ConfigInfra,
  DatosEmpresaCertificado,
  DatosMetricasCertificado,
  DatosTransportistaCertificado,
  DatosViajeCertificado,
  ResultadoEmisionCertificado,
} from './tipos.js';

export interface ParametrosEmisionCertificado {
  viaje: DatosViajeCertificado;
  metricas: DatosMetricasCertificado;
  empresaShipper: DatosEmpresaCertificado;
  transportista?: DatosTransportistaCertificado;
  infra: ConfigInfra;
  /**
   * URL base para construir el verify endpoint que va en el PDF y en el
   * sidecar. Ejemplo: 'https://api.boosterchile.com'. Sin slash final.
   */
  verifyBaseUrl: string;
}

export async function emitirCertificado(
  params: ParametrosEmisionCertificado,
): Promise<ResultadoEmisionCertificado> {
  // (1) Cert X.509 — barato si está cacheado en GCS, ~150ms si hay que
  // emitirlo (1 sign de KMS).
  const cert = await obtenerOEmitirCertSelfSigned({
    kmsKeyId: params.infra.kmsKeyId,
    certificatesBucket: params.infra.certificatesBucket,
  });

  // (2) PDF base con placeholder de firma.
  const verifyUrl = `${params.verifyBaseUrl.replace(/\/$/, '')}/certificates/${params.viaje.trackingCode}/verify`;
  const pdfBytes = await generarPdfBase({
    viaje: params.viaje,
    metricas: params.metricas,
    empresaShipper: params.empresaShipper,
    ...(params.transportista ? { transportista: params.transportista } : {}),
    verifyUrl,
  });

  // (3) Firma PAdES — invoca KMS 1 vez para firmar los signedAttrs PKCS7.
  const firma = await firmarPades({
    pdfBytes,
    cert,
    kmsKeyId: params.infra.kmsKeyId,
  });

  // (4) Upload a GCS.
  const upload = await subirArtefactosCertificado({
    bucket: params.infra.certificatesBucket,
    empresaId: params.empresaShipper.id,
    trackingCode: params.viaje.trackingCode,
    firma,
    cert,
    kmsKeyId: params.infra.kmsKeyId,
    verifyBaseUrl: params.verifyBaseUrl,
  });

  return {
    pdfGcsUri: upload.pdfGcsUri,
    sigGcsUri: upload.sigGcsUri,
    pdfSha256: firma.pdfSha256,
    kmsKeyVersion: firma.kmsKeyVersion,
    issuedAt: firma.signingTime,
    pdfBytes: firma.pdfFirmado.length,
  };
}
