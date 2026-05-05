/**
 * Wrapper de Cloud KMS asymmetric signing. Aislado del resto del package
 * para:
 *   - Reusar entre `ca-self-signed.ts` (firma el cert X.509) y
 *     `firmar-pades.ts` (firma el PDF).
 *   - Mockearlo en tests sin tocar GCP.
 *   - Centralizar el manejo de versión y latencia (KMS sign tarda ~50ms
 *     por firma RSA 4096).
 */

import { createHash } from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';

let cachedClient: KeyManagementServiceClient | null = null;

function getClient(): KeyManagementServiceClient {
  if (!cachedClient) {
    cachedClient = new KeyManagementServiceClient();
  }
  return cachedClient;
}

export interface ResultadoFirmaKms {
  /** Firma raw en bytes (RSA-PSS 4096 SHA-256 → 512 bytes). */
  signature: Buffer;
  /** Versión de la key usada (e.g. "1", "2"). Para persistir + verify. */
  keyVersion: string;
  /**
   * Resource name completo de la version usada. Útil para logs/audit.
   * Ej: projects/.../keyRings/.../cryptoKeys/.../cryptoKeyVersions/1
   */
  keyVersionName: string;
}

/**
 * Firma `data` con la version PRIMARY de la KMS key.
 *
 * KMS RSA-PSS necesita el digest pre-calculado (no acepta los bytes
 * raw): le mandamos `sha256(data)` y él lo firma con PSS padding.
 *
 * @param kmsKeyId Resource ID de la key (sin :versions).
 * @param data Bytes a firmar (no el hash — lo calculamos acá).
 */
export async function firmarConKms(
  kmsKeyId: string,
  data: Buffer | Uint8Array,
): Promise<ResultadoFirmaKms> {
  const client = getClient();

  // KMS no aplica el hash internamente para asymmetric_sign; debemos
  // mandarle el digest pre-calculado matching el algoritmo de la key.
  const digest = createHash('sha256')
    .update(data instanceof Buffer ? data : Buffer.from(data))
    .digest();

  // Resolvemos la versión PRIMARY actual de la key. Sin esto tendríamos
  // que hardcodear "/cryptoKeyVersions/1", lo que rompe cuando rote.
  const primaryVersion = await resolverVersionPrimaria(client, kmsKeyId);

  const [response] = await client.asymmetricSign({
    name: primaryVersion,
    digest: { sha256: digest },
  });

  if (!response.signature) {
    throw new Error('KMS asymmetricSign devolvió signature vacía');
  }

  // El SDK puede devolver la firma como Buffer o Uint8Array dependiendo
  // de la versión; normalizamos a Buffer.
  const signatureBuf = Buffer.isBuffer(response.signature)
    ? response.signature
    : Buffer.from(response.signature);

  // Validamos la integridad del transporte: KMS devuelve un CRC32C que
  // debe matchear lo que recibimos. Sin esto, un bit-flip en la red
  // podría producir un PDF "firmado" pero inválido al verificar.
  if (response.verifiedDigestCrc32c === false) {
    throw new Error('KMS reportó CRC32C inválido en el digest enviado');
  }

  // Extraemos la versión "1", "2", etc. del resource name completo.
  const versionMatch = primaryVersion.match(/cryptoKeyVersions\/(\d+)$/);
  if (!versionMatch) {
    throw new Error(`No pude parsear key version de: ${primaryVersion}`);
  }

  return {
    signature: signatureBuf,
    keyVersion: versionMatch[1] ?? '',
    keyVersionName: primaryVersion,
  };
}

/**
 * Lee la public key PEM de la version PRIMARY de la KMS key. Usada para
 * incluir en el cert X.509 self-signed y exponer en /verify.
 */
export async function obtenerPublicKeyPem(kmsKeyId: string): Promise<{
  pem: string;
  keyVersion: string;
  keyVersionName: string;
}> {
  const client = getClient();
  const versionName = await resolverVersionPrimaria(client, kmsKeyId);

  const [publicKey] = await client.getPublicKey({ name: versionName });

  if (!publicKey.pem) {
    throw new Error(`KMS getPublicKey devolvió pem vacío para ${versionName}`);
  }

  const versionMatch = versionName.match(/cryptoKeyVersions\/(\d+)$/);
  if (!versionMatch) {
    throw new Error(`No pude parsear key version de: ${versionName}`);
  }

  return {
    pem: publicKey.pem,
    keyVersion: versionMatch[1] ?? '',
    keyVersionName: versionName,
  };
}

/**
 * Listamos las versions de la key y elegimos la PRIMARY (la activa para
 * firmar). KMS no expone "primary version" directamente para asymmetric
 * keys — usamos la más alta en estado ENABLED.
 *
 * Si en el futuro queremos pinar a una versión específica (ej. para
 * regenerar firmas históricas), agregar `kmsKeyVersionOverride` al config.
 */
async function resolverVersionPrimaria(
  client: KeyManagementServiceClient,
  kmsKeyId: string,
): Promise<string> {
  const [versions] = await client.listCryptoKeyVersions({
    parent: kmsKeyId,
    filter: 'state=ENABLED',
  });

  if (!versions.length) {
    throw new Error(`KMS key ${kmsKeyId} no tiene ninguna version ENABLED — no se puede firmar`);
  }

  // Las versions vienen ordenadas por createTime asc; la más reciente
  // ENABLED es la que queremos firmar. Si hay rotación pendiente, la
  // nueva ya está acá.
  const sorted = [...versions].sort((a, b) => {
    const aNum = Number((a.name ?? '').match(/(\d+)$/)?.[1] ?? 0);
    const bNum = Number((b.name ?? '').match(/(\d+)$/)?.[1] ?? 0);
    return bNum - aNum;
  });

  const primary = sorted[0];
  if (!primary?.name) {
    throw new Error(`No pude resolver primary version de ${kmsKeyId}`);
  }
  return primary.name;
}
