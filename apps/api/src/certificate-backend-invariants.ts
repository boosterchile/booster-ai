/**
 * Invariante del backend de certificados (T10-02).
 *
 * `@booster-ai/certificate-generator` acepta un backend local para el E2E del
 * conductor: `CERTIFICATE_SIGNING_KEY_ID=local:<nombre>` (clave RSA efímera en
 * memoria) y `CERTIFICATES_BUCKET=file:<dir>` (disco). Un certificado firmado
 * así no vale para un cliente, de modo que en producción el startup falla si
 * aparece cualquiera de los dos prefijos. El package se niega además a operar
 * con NODE_ENV=production (doble guarda).
 *
 * Función pura; `config.ts` la invoca desde su `superRefine`.
 */
import { esBucketLocal, esKeyLocal } from '@booster-ai/certificate-generator';

export interface CertificateBackendInvariantInput {
  nodeEnv: string;
  signingKeyId?: string | undefined;
  certificatesBucket?: string | undefined;
}

export function checkCertificateBackendInvariants(
  input: CertificateBackendInvariantInput,
): string[] {
  if (input.nodeEnv !== 'production') {
    return [];
  }
  const errors: string[] = [];
  if (input.signingKeyId && esKeyLocal(input.signingKeyId)) {
    errors.push(
      'CERTIFICATE_SIGNING_KEY_ID con prefijo local: no está permitido en producción (usar la key de Cloud KMS)',
    );
  }
  if (input.certificatesBucket && esBucketLocal(input.certificatesBucket)) {
    errors.push(
      'CERTIFICATES_BUCKET con prefijo file: no está permitido en producción (usar el bucket GCS)',
    );
  }
  return errors;
}
