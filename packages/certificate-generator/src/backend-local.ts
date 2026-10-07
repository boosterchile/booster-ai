/**
 * Backend local de firma y almacenamiento para el E2E del flujo del
 * conductor (T10-02): emite un certificado real (PDF PAdES firmado +
 * sidecar + cert X.509) sin Cloud KMS ni GCS.
 *
 * Se elige SOLO por prefijo explícito en la config existente:
 *   - CERTIFICATE_SIGNING_KEY_ID = `local:<nombre>` → clave RSA 4096 efímera
 *     generada en memoria al primer uso. Mismo algoritmo que la key KMS
 *     (RSA_SIGN_PKCS1_4096_SHA256, ADR-015), así el resto del pipeline no
 *     distingue el origen de la firma.
 *   - CERTIFICATES_BUCKET = `file:<directorio>` → artefactos en disco.
 *
 * Nunca opera con NODE_ENV=production: una firma con clave efímera no es
 * un certificado válido para un cliente. La config del api rechaza además
 * los prefijos en producción (doble guarda).
 */

import { createSign, generateKeyPair } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { GetSignedUrlConfig, SaveOptions } from '@google-cloud/storage';
import type { ResultadoFirmaKms } from './firmar-kms.js';

const PREFIJO_KEY = 'local:';
const PREFIJO_BUCKET = 'file:';
const VERSION_LOCAL = '1';

export class BackendLocalEnProduccionError extends Error {
  constructor(recurso: string) {
    super(
      `Backend local de certificados (${recurso}) no permitido con NODE_ENV=production: usar Cloud KMS y GCS`,
    );
    this.name = 'BackendLocalEnProduccionError';
  }
}

export function esKeyLocal(kmsKeyId: string): boolean {
  return kmsKeyId.startsWith(PREFIJO_KEY);
}

export function esBucketLocal(bucket: string): boolean {
  return bucket.startsWith(PREFIJO_BUCKET);
}

function asegurarFueraDeProduccion(recurso: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new BackendLocalEnProduccionError(recurso);
  }
}

interface ParLocal {
  privateKeyPem: string;
  publicKeyPem: string;
}

const generarPar = promisify(generateKeyPair);
const pares = new Map<string, Promise<ParLocal>>();

/**
 * Par RSA 4096 por nombre de key, generado una vez por proceso. Asíncrono:
 * la generación tarda segundos y no debe bloquear el event loop del API.
 * Se cachea la promesa para que llamadas concurrentes compartan un par.
 */
function obtenerPar(kmsKeyId: string): Promise<ParLocal> {
  const existente = pares.get(kmsKeyId);
  if (existente) {
    return existente;
  }
  const par = generarPar('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).then(({ privateKey, publicKey }) => ({ privateKeyPem: privateKey, publicKeyPem: publicKey }));
  pares.set(kmsKeyId, par);
  par.catch(() => pares.delete(kmsKeyId));
  return par;
}

function nombreVersion(kmsKeyId: string): string {
  return `${kmsKeyId}/cryptoKeyVersions/${VERSION_LOCAL}`;
}

export async function firmarConKeyLocal(
  kmsKeyId: string,
  data: Buffer | Uint8Array,
): Promise<ResultadoFirmaKms> {
  asegurarFueraDeProduccion(kmsKeyId);
  const { privateKeyPem } = await obtenerPar(kmsKeyId);
  const signature = createSign('sha256')
    .update(data instanceof Buffer ? data : Buffer.from(data))
    .sign(privateKeyPem);
  return {
    signature,
    keyVersion: VERSION_LOCAL,
    keyVersionName: nombreVersion(kmsKeyId),
  };
}

export async function obtenerPublicKeyLocal(kmsKeyId: string): Promise<{
  pem: string;
  keyVersion: string;
  keyVersionName: string;
}> {
  asegurarFueraDeProduccion(kmsKeyId);
  return {
    pem: (await obtenerPar(kmsKeyId)).publicKeyPem,
    keyVersion: VERSION_LOCAL,
    keyVersionName: nombreVersion(kmsKeyId),
  };
}

/**
 * Subconjunto de `File` de @google-cloud/storage que usa este package.
 * Las firmas de retorno (tuplas) imitan las del SDK para que los callers
 * no ramifiquen.
 */
export interface ArchivoBucket {
  save(data: string | Buffer, options?: SaveOptions): Promise<void>;
  exists(): Promise<[boolean]>;
  download(): Promise<[Buffer]>;
  getSignedUrl(config: GetSignedUrlConfig): Promise<[string]>;
}

export interface BucketCertificados {
  file(path: string): ArchivoBucket;
}

export function abrirBucketLocal(bucket: string): BucketCertificados {
  asegurarFueraDeProduccion(bucket);
  const base = resolve(bucket.slice(PREFIJO_BUCKET.length));
  const rutaDe = (path: string): string => {
    const destino = resolve(base, path);
    if (!destino.startsWith(base + sep)) {
      throw new Error(`Path ${path} fuera del bucket local ${base}`);
    }
    return destino;
  };
  return {
    file(path: string): ArchivoBucket {
      return {
        async save(data) {
          const destino = rutaDe(path);
          await mkdir(dirname(destino), { recursive: true });
          await writeFile(destino, data);
        },
        async exists() {
          try {
            await stat(rutaDe(path));
            return [true];
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return [false];
            }
            throw err;
          }
        },
        async download() {
          return [await readFile(rutaDe(path))];
        },
        async getSignedUrl() {
          throw new Error(
            `El bucket local ${base} no emite signed URL: la descarga del PDF requiere GCS`,
          );
        },
      };
    },
  };
}
