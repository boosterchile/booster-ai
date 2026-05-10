/**
 * Emisión de certificados X.509 self-signed sobre la public key de KMS.
 *
 * Por qué este archivo existe:
 *   Cloud KMS no emite certificados X.509 — solo expone public keys raw
 *   en formato PEM. Para que Adobe Reader / herramientas de validación
 *   PAdES muestren "firma válida" con identidad, la firma PAdES debe
 *   incluir un cert X.509 que ate la public key de KMS a una identidad
 *   (CN, O, OU, etc.). Este archivo construye ese cert.
 *
 *   El cert es self-signed: la "CA" emisora es Booster mismo. El modelo
 *   de confianza es "validar contra la public key publicada por Booster
 *   en /.well-known/ + endpoint /verify". No usamos una CA externa
 *   (Let's Encrypt no firma certs para signing, solo TLS).
 *
 * Caching:
 *   El cert se emite UNA vez por key version y se guarda en GCS
 *   `gs://{bucket}/certs/kms-key-version-{n}.pem`. Cada certificado de
 *   carbono firmado con esa key version reusa el mismo cert. Cuando KMS
 *   rota a una versión nueva, se emite y cachea un cert nuevo lazily al
 *   primer uso.
 */

import { Storage } from '@google-cloud/storage';
import forge from 'node-forge';
import { firmarConKms, obtenerPublicKeyPem } from './firmar-kms.js';

let cachedStorage: Storage | null = null;

function getStorage(): Storage {
  if (!cachedStorage) {
    cachedStorage = new Storage();
  }
  return cachedStorage;
}

/**
 * Validez del cert. 10 años — los certificados de carbono ya emitidos
 * deben seguir verificándose mucho después de que la KMS key rote, así
 * que cada cert por version tiene vida larga.
 */
const VALIDEZ_AÑOS = 10;

/**
 * Subject DN del cert. Identifica a Booster como emisor.
 */
const SUBJECT_ATTRS = [
  { name: 'commonName', value: 'Booster Carbono CL' },
  { name: 'countryName', value: 'CL' },
  { name: 'organizationName', value: 'Booster Chile SpA' },
  { name: 'organizationalUnitName', value: 'Sustentabilidad' },
];

export interface CertSelfSignedResultado {
  /** Cert X.509 en formato PEM. */
  certPem: string;
  /** Cert parseado por node-forge (útil para PKCS7 signing sin re-parse). */
  certForge: forge.pki.Certificate;
  /** Public key PEM (la misma que está dentro del cert, exposed para /verify). */
  publicKeyPem: string;
  /** Versión KMS sobre la que se emitió este cert. */
  kmsKeyVersion: string;
}

/**
 * Devuelve el cert X.509 cacheado en GCS para esta key version, o lo
 * emite + cachea si no existe.
 */
export async function obtenerOEmitirCertSelfSigned(opts: {
  kmsKeyId: string;
  certificatesBucket: string;
}): Promise<CertSelfSignedResultado> {
  const { pem: publicKeyPem, keyVersion } = await obtenerPublicKeyPem(opts.kmsKeyId);

  const cachedPath = `certs/kms-key-version-${keyVersion}.pem`;
  const bucket = getStorage().bucket(opts.certificatesBucket);
  const cachedFile = bucket.file(cachedPath);

  // Hot path: cert ya existe.
  const [exists] = await cachedFile.exists();
  if (exists) {
    const [contents] = await cachedFile.download();
    const certPem = contents.toString('utf-8');
    return {
      certPem,
      certForge: forge.pki.certificateFromPem(certPem),
      publicKeyPem,
      kmsKeyVersion: keyVersion,
    };
  }

  // Cold path: emitir nuevo cert.
  const certPem = await emitirNuevoCert(opts.kmsKeyId, publicKeyPem);

  // Subir cacheado. ContentType para que se sirva con el MIME correcto si
  // alguna vez exponemos el cert directo via signed URL.
  await cachedFile.save(certPem, {
    contentType: 'application/x-pem-file',
    metadata: {
      cacheControl: 'public, max-age=31536000', // 1 año
      metadata: {
        kms_key_id: opts.kmsKeyId,
        kms_key_version: keyVersion,
        emitted_by: '@booster-ai/certificate-generator',
      },
    },
  });

  return {
    certPem,
    certForge: forge.pki.certificateFromPem(certPem),
    publicKeyPem,
    kmsKeyVersion: keyVersion,
  };
}

/**
 * Construye el TBSCertificate, lo manda a firmar a KMS, y ensambla el
 * cert X.509 final en PEM.
 */
async function emitirNuevoCert(kmsKeyId: string, publicKeyPem: string): Promise<string> {
  const cert = forge.pki.createCertificate();

  // Public key — la real de KMS, no una local.
  cert.publicKey = forge.pki.publicKeyFromPem(publicKeyPem);

  // Serial number único — usamos timestamp + random para evitar colisión
  // si emitimos dos certs en la misma rotación.
  cert.serialNumber = generarSerialHex();

  // Validez 10 años desde ahora.
  const ahora = new Date();
  cert.validity.notBefore = ahora;
  const expira = new Date(ahora);
  expira.setFullYear(expira.getFullYear() + VALIDEZ_AÑOS);
  cert.validity.notAfter = expira;

  cert.setSubject(SUBJECT_ATTRS);
  cert.setIssuer(SUBJECT_ATTRS); // self-signed → issuer = subject

  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false, // este cert NO es una CA, solo end-entity para signing
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      // No keyEncipherment / keyAgreement — solo firmamos.
    },
    {
      name: 'extKeyUsage',
      // 1.3.6.1.5.5.7.3.36 = id-kp-documentSigning (RFC 9336).
      // Adobe Reader lo prefiere para firmas en PDFs vs el genérico.
      // Algunas versions de node-forge no lo conocen por nombre, lo
      // pasamos por OID.
      '1.3.6.1.5.5.7.3.36': true,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);

  // Algoritmo de firma — debe matchear lo que KMS va a producir.
  // sha256WithRSAEncryption (PKCS#1 v1.5) = OID 1.2.840.113549.1.1.11.
  // forge.pki.oids es Record<string,string> en types pero las constantes
  // son literales hardcoded del propio node-forge — defensiva por si la
  // versión cambia.
  const sigOid = forge.pki.oids.sha256WithRSAEncryption;
  if (sigOid === undefined) {
    throw new Error(
      'forge.pki.oids.sha256WithRSAEncryption no definido — versión incompatible de node-forge',
    );
  }
  cert.signatureOid = sigOid;
  cert.siginfo.algorithmOid = sigOid;

  // Construir el TBSCertificate (ASN.1) y DER-encodearlo. KMS firma esos
  // bytes; el resultado se inserta en cert.signature para producir el
  // cert X.509 final.
  // biome-ignore lint/suspicious/noExplicitAny: forge types incompletos
  const tbsAsn1 = (forge.pki as any).getTBSCertificate(cert);
  const tbsDer = forge.asn1.toDer(tbsAsn1).getBytes();
  const tbsBuffer = Buffer.from(tbsDer, 'binary');

  // KMS hace internamente sha256(tbsBuffer) y firma con la privkey RSA.
  const { signature } = await firmarConKms(kmsKeyId, tbsBuffer);

  // node-forge espera la firma como binary string (no Buffer).
  cert.signature = signature.toString('binary');

  // Sanity check: parsear el PEM resultante para asegurar que el cert es
  // estructuralmente válido. Si la firma quedó corrupta, esto throwea.
  const certPem = forge.pki.certificateToPem(cert);
  forge.pki.certificateFromPem(certPem);

  return certPem;
}

/**
 * Genera un serial number hex de 16 bytes (128 bits) — RFC 5280 exige
 * positivo, no más de 20 bytes. 16 es seguro y suficiente para evitar
 * colisión.
 */
function generarSerialHex(): string {
  const bytes = forge.random.getBytesSync(16);
  // Forzar el bit alto a 0 para que sea positivo (X.509 usa enteros sin
  // signo en serial pero ASN.1 los serializa con signo — bit alto en 1
  // se interpreta como negativo).
  const firstByte = bytes.charCodeAt(0) & 0x7f;
  const adjusted = String.fromCharCode(firstByte) + bytes.slice(1);
  return forge.util.bytesToHex(adjusted);
}
