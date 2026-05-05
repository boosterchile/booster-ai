/**
 * Firma PAdES de un PDF usando KMS como signing oracle remoto.
 *
 * Flujo:
 *   1. El PDF de input ya tiene un placeholder de firma (insertado por
 *      `generar-pdf-base.ts` con @signpdf/placeholder-plain). El placeholder
 *      define un /ByteRange [a b c d] que cubre todo el PDF EXCEPTO los
 *      bytes del placeholder mismo.
 *   2. @signpdf/signpdf calcula los bytes del ByteRange y nos los pasa
 *      al método sign(...) del Signer custom.
 *   3. Construimos el PKCS7 SignedData con node-forge ASN.1 (manual,
 *      porque forge.pkcs7.sign() exige privkey local que no tenemos —
 *      está en KMS).
 *   4. KMS firma los signed attributes del PKCS7. Insertamos la firma
 *      en el SignerInfo y devolvemos el DER del ContentInfo completo.
 *   5. @signpdf/signpdf reemplaza el placeholder con el PKCS7 hex.
 *
 * Resultado: PDF con firma PAdES-B-B (basic) válida en Adobe Reader.
 */

import { createHash } from 'node:crypto';
import { SignPdf } from '@signpdf/signpdf';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import forge from 'node-forge';
import type { CertSelfSignedResultado } from './ca-self-signed.js';
import { firmarConKms } from './firmar-kms.js';

export interface ParametrosFirmaPades {
  /** PDF generado por `generar-pdf-base.ts` (con placeholder embebido). */
  pdfBytes: Uint8Array;
  /** Cert X.509 emitido por `obtenerOEmitirCertSelfSigned`. */
  cert: CertSelfSignedResultado;
  /** Resource ID de la KMS key (sin :versions). */
  kmsKeyId: string;
}

export interface ResultadoFirmaPades {
  /** PDF con firma PAdES embebida en el placeholder. */
  pdfFirmado: Buffer;
  /** SHA-256 hex (lowercase) del PDF firmado. */
  pdfSha256: string;
  /** Firma raw de KMS sobre los signed attributes (para sidecar .sig). */
  signatureRaw: Buffer;
  /** Versión KMS usada. */
  kmsKeyVersion: string;
  /** Timestamp incluido como signing time en el SignedAttrs. */
  signingTime: Date;
}

/**
 * Firma el PDF con PAdES-B-B usando KMS.
 */
export async function firmarPades(params: ParametrosFirmaPades): Promise<ResultadoFirmaPades> {
  const signingTime = new Date();
  let signatureRaw: Buffer | null = null;

  // SignPdf custom signer — invocado UNA vez por sign() con los bytes
  // del PDF que entran en /ByteRange (todo el PDF excepto el placeholder).
  const signer = {
    async sign(pdfToSign: Buffer): Promise<Buffer> {
      const pkcs7Result = await construirPkcs7(
        pdfToSign,
        params.cert,
        params.kmsKeyId,
        signingTime,
      );
      // Capturamos la firma raw para devolverla al caller (sidecar .sig).
      signatureRaw = pkcs7Result.signatureRaw;
      return pkcs7Result.pkcs7Der;
    },
  };

  const signpdf = new SignPdf();
  const pdfBuffer = Buffer.from(params.pdfBytes);
  const pdfFirmado = await signpdf.sign(pdfBuffer, signer);

  if (!signatureRaw) {
    throw new Error('Signer no fue invocado — placeholder mal formado en PDF');
  }

  const pdfSha256 = createHash('sha256').update(pdfFirmado).digest('hex');

  return {
    pdfFirmado,
    pdfSha256,
    signatureRaw,
    kmsKeyVersion: params.cert.kmsKeyVersion,
    signingTime,
  };
}

// ============================================================
// PKCS7 SignedData manual con node-forge ASN.1
// ============================================================

interface Pkcs7Result {
  pkcs7Der: Buffer;
  signatureRaw: Buffer;
}

/**
 * Construye el ContentInfo PKCS7 SignedData (detached, eContent vacío)
 * sobre el digest del PDF.
 *
 * Estructura ASN.1 (RFC 5652):
 *   ContentInfo ::= SEQUENCE {
 *     contentType OBJECT IDENTIFIER (1.2.840.113549.1.7.2 = signedData),
 *     content [0] EXPLICIT SignedData
 *   }
 *
 *   SignedData ::= SEQUENCE {
 *     version INTEGER (1),
 *     digestAlgorithms SET OF AlgorithmIdentifier,
 *     encapContentInfo SEQUENCE {
 *       eContentType OBJECT IDENTIFIER (1.2.840.113549.1.7.1 = data)
 *     },
 *     certificates [0] IMPLICIT SET OF Certificate,
 *     signerInfos SET OF SignerInfo
 *   }
 *
 *   SignerInfo ::= SEQUENCE {
 *     version INTEGER (1),
 *     sid SignerIdentifier (issuerAndSerialNumber),
 *     digestAlgorithm AlgorithmIdentifier,
 *     signedAttrs [0] IMPLICIT SET OF Attribute,
 *     signatureAlgorithm AlgorithmIdentifier,
 *     signature OCTET STRING
 *   }
 */
async function construirPkcs7(
  pdfBytes: Buffer,
  cert: CertSelfSignedResultado,
  kmsKeyId: string,
  signingTime: Date,
): Promise<Pkcs7Result> {
  const asn1 = forge.asn1;
  const oids = forge.pki.oids;

  // Hash del PDF — va en el messageDigest signed attribute.
  const pdfDigest = createHash('sha256').update(pdfBytes).digest();

  // Signed attributes: contentType, messageDigest, signingTime.
  // En PKCS7 detached con signedAttrs, lo que se firma NO es el
  // pdfDigest, sino el DER-encoded SET OF Attribute. Esto agrega
  // signingTime + binding al contentType y previene replay attacks.
  // forge.pki.oids está typed como Record<string, string> pero en runtime
  // las constantes (contentType, data, messageDigest, etc.) son literales
  // hardcoded del propio node-forge — los `!` son seguros.
  const signedAttrsAsn1 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
    crearAtributo(
      oids.contentType!,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oids.data!).getBytes()),
    ),
    crearAtributo(
      oids.messageDigest!,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, pdfDigest.toString('binary')),
    ),
    crearAtributo(
      oids.signingTime!,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(signingTime)),
    ),
  ]);

  // KMS firma el DER-encoded SET (con tag SET, NO con tag implicit [0]).
  // Esto es crítico: para firmar, se usa el universal SET tag; en el
  // SignerInfo, los signedAttrs van con tag implicit [0]. RFC 5652 §5.4.
  const signedAttrsDer = asn1.toDer(signedAttrsAsn1).getBytes();
  const signedAttrsBuf = Buffer.from(signedAttrsDer, 'binary');

  // KMS hace sha256(signedAttrsBuf) internamente y firma con RSA.
  const { signature: signatureRaw } = await firmarConKms(kmsKeyId, signedAttrsBuf);

  // Re-construir signedAttrs con tag IMPLICIT [0] para el SignerInfo.
  const signedAttrsImplicit = asn1.create(
    asn1.Class.CONTEXT_SPECIFIC,
    0,
    true,
    signedAttrsAsn1.value,
  );

  // SignerIdentifier — issuerAndSerialNumber.
  const issuer = forge.pki.distinguishedNameToAsn1({
    attributes: cert.certForge.issuer.attributes,
  });

  // Serial number como INTEGER.
  const serialDer = forge.util.hexToBytes(cert.certForge.serialNumber);
  const serialAsn1 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, serialDer);

  const sid = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [issuer, serialAsn1]);

  // AlgorithmIdentifier helpers.
  const sha256AlgId = crearAlgoritmoId(oids.sha256!);
  // Algunos validadores PAdES esperan sha256WithRSAEncryption en el
  // signatureAlgorithm en vez de rsaEncryption puro. RFC 5652 acepta
  // ambos, pero usar sha256WithRSAEncryption es más explícito.
  const sigAlgId = crearAlgoritmoId(oids.sha256WithRSAEncryption!);

  // SignerInfo SEQUENCE.
  const signerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    sid,
    sha256AlgId,
    signedAttrsImplicit,
    sigAlgId,
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.OCTETSTRING,
      false,
      signatureRaw.toString('binary'),
    ),
  ]);

  // Cert ASN.1.
  const certAsn1 = forge.pki.certificateToAsn1(cert.certForge);

  // SignedData SEQUENCE.
  const signedData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [sha256AlgId]),
    // encapContentInfo — detached: solo eContentType, sin eContent.
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oids.data!).getBytes()),
    ]),
    // certificates [0] IMPLICIT SET OF Certificate.
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [certAsn1]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signerInfo]),
  ]);

  // ContentInfo SEQUENCE — wrapper externo.
  const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.OID,
      false,
      asn1.oidToDer(oids.signedData!).getBytes(),
    ),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);

  const pkcs7Der = Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');

  // Documentamos que estamos usando ETSI.CAdES.detached como SubFilter,
  // alineado con PAdES-B-B. Esto se setea cuando construimos el placeholder
  // (en generar-pdf-base.ts vía @signpdf/placeholder-plain default).
  void SUBFILTER_ETSI_CADES_DETACHED;

  return { pkcs7Der, signatureRaw };
}

/**
 * Helper para construir un Attribute ASN.1: SEQUENCE { type, values SET }.
 */
function crearAtributo(typeOid: string, value: forge.asn1.Asn1): forge.asn1.Asn1 {
  const asn1 = forge.asn1;
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(typeOid).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [value]),
  ]);
}

/**
 * AlgorithmIdentifier ::= SEQUENCE { algorithm OID, parameters NULL }.
 * Para PKCS#1 v1.5 + SHA256 los parámetros van NULL (no requiere PSS-style
 * params). Esto es el motivo principal por el que cambiamos de PSS a PKCS1
 * en este proyecto: PSS exige hashAlgorithm + maskGenAlgorithm + saltLength
 * en los parámetros, lo que rompe validadores PAdES viejos.
 */
function crearAlgoritmoId(oid: string): forge.asn1.Asn1 {
  const asn1 = forge.asn1;
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
  ]);
}
