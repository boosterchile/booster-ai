/**
 * Upload de los 3 artefactos del certificado a GCS:
 *   1. PDF firmado (embed PAdES) — gs://{bucket}/certificates/{empresa}/{tracking}.pdf
 *   2. Sidecar firma JSON — gs://{bucket}/certificates/{empresa}/{tracking}.pdf.sig
 *   3. Cert X.509 self-signed — gs://{bucket}/certs/kms-key-version-{n}.pem
 *      (este lo sube `ca-self-signed.ts`, acá solo subimos los dos del viaje)
 *
 * Naming: el path incluye empresaId para aislar por tenant. Sin esto, si
 * dos empresas tienen el mismo trackingCode (no debería pasar — son uniq
 * globales — pero defensivo) habría sobreescritura.
 *
 * Permisos: las 3 son private (uniform_bucket_level_access=true).
 * Acceso vía signed URLs generadas por el endpoint download.
 */

import { Storage } from '@google-cloud/storage';
import type { ResultadoFirmaPades } from './firmar-pades.js';
import type { CertSelfSignedResultado } from './ca-self-signed.js';
import type { SidecarFirma } from './tipos.js';

let cachedStorage: Storage | null = null;

function getStorage(): Storage {
  if (!cachedStorage) {
    cachedStorage = new Storage();
  }
  return cachedStorage;
}

export interface ParametrosUpload {
  bucket: string;
  empresaId: string;
  trackingCode: string;
  firma: ResultadoFirmaPades;
  cert: CertSelfSignedResultado;
  kmsKeyId: string;
  /** URL pública del endpoint /verify para incluir en el sidecar. */
  verifyBaseUrl: string;
}

export interface ResultadoUpload {
  pdfGcsUri: string;
  sigGcsUri: string;
}

export async function subirArtefactosCertificado(
  params: ParametrosUpload,
): Promise<ResultadoUpload> {
  const bucket = getStorage().bucket(params.bucket);

  const baseDir = `certificates/${params.empresaId}`;
  const pdfPath = `${baseDir}/${params.trackingCode}.pdf`;
  const sigPath = `${baseDir}/${params.trackingCode}.pdf.sig`;

  // 1) PDF firmado.
  await bucket.file(pdfPath).save(params.firma.pdfFirmado, {
    contentType: 'application/pdf',
    metadata: {
      // Cache-Control corto: el PDF puede regenerarse si pedimos
      // re-emisión (ej. con datos corregidos), no queremos CDN viejo.
      cacheControl: 'private, max-age=3600',
      metadata: {
        tracking_code: params.trackingCode,
        kms_key_version: params.firma.kmsKeyVersion,
        sha256: params.firma.pdfSha256,
        signed_at: params.firma.signingTime.toISOString(),
        emitted_by: '@booster-ai/certificate-generator',
      },
    },
  });

  // 2) Sidecar JSON con firma raw + metadata + cert PEM.
  // Este archivo es lo que un auditor descarga junto con el PDF para
  // validar offline con OpenSSL.
  const sidecar: SidecarFirma = {
    trackingCode: params.trackingCode,
    signedAt: params.firma.signingTime.toISOString(),
    algorithm: 'RSA_SIGN_PKCS1_4096_SHA256',
    kmsKeyId: params.kmsKeyId,
    kmsKeyVersion: params.firma.kmsKeyVersion,
    pdfSha256: params.firma.pdfSha256,
    signatureB64: params.firma.signatureRaw.toString('base64'),
    certPem: params.cert.certPem,
    verifyUrl: `${params.verifyBaseUrl.replace(/\/$/, '')}/certificates/${params.trackingCode}/verify`,
  };

  await bucket.file(sigPath).save(JSON.stringify(sidecar, null, 2), {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'private, max-age=3600',
      metadata: {
        tracking_code: params.trackingCode,
        kms_key_version: params.firma.kmsKeyVersion,
      },
    },
  });

  return {
    pdfGcsUri: `gs://${params.bucket}/${pdfPath}`,
    sigGcsUri: `gs://${params.bucket}/${sigPath}`,
  };
}

/**
 * Genera una signed URL temporal para descargar el PDF. La usa el endpoint
 * GET /trip-requests-v2/:id/certificate/download.
 */
export async function generarSignedUrlPdf(opts: {
  bucket: string;
  empresaId: string;
  trackingCode: string;
  /** TTL en segundos. Default 5 minutos. */
  ttlSeconds?: number;
}): Promise<string> {
  const bucket = getStorage().bucket(opts.bucket);
  const file = bucket.file(`certificates/${opts.empresaId}/${opts.trackingCode}.pdf`);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + (opts.ttlSeconds ?? 300) * 1000,
    responseDisposition: `attachment; filename="certificado-carbono-${opts.trackingCode}.pdf"`,
  });
  return url;
}

/**
 * Descarga el sidecar .sig desde GCS. Usado por el endpoint público
 * /certificates/:tracking/verify para devolver la firma + cert al
 * caller sin requerir auth.
 */
export async function descargarSidecar(opts: {
  bucket: string;
  empresaId: string;
  trackingCode: string;
}): Promise<SidecarFirma | null> {
  const bucket = getStorage().bucket(opts.bucket);
  const file = bucket.file(
    `certificates/${opts.empresaId}/${opts.trackingCode}.pdf.sig`,
  );
  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }
  const [contents] = await file.download();
  return JSON.parse(contents.toString('utf-8')) as SidecarFirma;
}
