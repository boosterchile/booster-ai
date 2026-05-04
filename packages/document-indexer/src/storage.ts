import { createHash } from 'node:crypto';
import type { DocumentType } from '@booster-ai/shared-schemas';
import { Storage } from '@google-cloud/storage';

let cachedStorage: Storage | null = null;

function getStorage(): Storage {
  if (!cachedStorage) {
    cachedStorage = new Storage();
  }
  return cachedStorage;
}

/** Permite inyectar mock de Storage en tests. */
export function setStorageForTesting(stub: Storage | null): void {
  cachedStorage = stub;
}

/**
 * Layout canónico del bucket. Ver ADR-007 §"Arquitectura de almacenamiento".
 *
 * Particionado por año/mes para que las queries de BigQuery sobre
 * `document_events` puedan correlacionar con eventos del trip rápido y
 * para que el lifecycle policy (Archive después de 2 años) opere a nivel
 * de prefijo.
 */
export function buildGcsPath(opts: {
  type: DocumentType;
  empresaId: string;
  /** Identificador estable del archivo (folio, trip_id, hash, etc.). */
  identifier: string;
  /** Default = ahora. */
  emittedAt?: Date;
  /** Extensión sin punto (`pdf`, `xml`, `jpg`). */
  ext: string;
}): string {
  const at = opts.emittedAt ?? new Date();
  const yyyy = at.getUTCFullYear().toString();
  const mm = (at.getUTCMonth() + 1).toString().padStart(2, '0');
  const prefix = pathPrefix(opts.type);
  // empresaId aislado por tenant para que IAM por prefijo sea posible.
  return `${prefix}/${yyyy}/${mm}/${opts.empresaId}/${opts.identifier}.${opts.ext}`;
}

function pathPrefix(type: DocumentType): string {
  switch (type) {
    case 'dte_guia_despacho':
    case 'dte_factura':
    case 'dte_factura_exenta':
      return 'dte';
    case 'carta_porte':
      return 'carta-porte';
    case 'acta_entrega':
      return 'acta-entrega';
    case 'certificado_esg':
      return 'certificados';
    case 'foto_pickup':
    case 'foto_delivery':
      return 'photos';
    case 'firma_receptor':
      return 'signatures';
    case 'checklist_vehiculo':
      return 'checklists';
    case 'factura_externa':
    case 'comprobante_pago':
      return 'external-upload';
    case 'otro':
      return 'misc';
  }
}

export interface UploadOpts {
  bucket: string;
  gcsPath: string;
  body: Uint8Array | Buffer;
  mimeType: string;
  metadata?: Record<string, string>;
}

export interface UploadOutcome {
  gcsUri: string;
  sha256: string;
  sizeBytes: number;
}

export async function uploadObject(opts: UploadOpts): Promise<UploadOutcome> {
  const bucket = getStorage().bucket(opts.bucket);
  const buf = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body);
  const sha256 = createHash('sha256').update(buf).digest('hex');

  await bucket.file(opts.gcsPath).save(buf, {
    contentType: opts.mimeType,
    metadata: {
      // Cache-Control corto: regen posible (ej. carta de porte con datos
      // corregidos). No queremos CDN viejo para docs legales.
      cacheControl: 'private, max-age=3600',
      metadata: {
        sha256,
        emitted_by: '@booster-ai/document-indexer',
        ...opts.metadata,
      },
    },
  });

  return {
    gcsUri: `gs://${opts.bucket}/${opts.gcsPath}`,
    sha256,
    sizeBytes: buf.byteLength,
  };
}

/**
 * Genera signed URL v4 para descarga directa. Default TTL 5 minutos.
 * `disposition=attachment` fuerza download (vs visualización inline)
 * para asegurar que documentos legales se descarguen y no queden en
 * cache de browser sin nombre.
 */
export async function generateSignedDownloadUrl(opts: {
  bucket: string;
  gcsPath: string;
  /** TTL en segundos. Default 300 (5 min). */
  ttlSeconds?: number;
  /** Filename para el header Content-Disposition. */
  downloadAs?: string;
}): Promise<string> {
  const bucket = getStorage().bucket(opts.bucket);
  const file = bucket.file(opts.gcsPath);
  const ttl = (opts.ttlSeconds ?? 300) * 1000;
  const responseDisposition = opts.downloadAs
    ? `attachment; filename="${escapeQuotedFilename(opts.downloadAs)}"`
    : 'attachment';
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + ttl,
    responseDisposition,
  });
  return url;
}

export async function downloadObject(opts: {
  bucket: string;
  gcsPath: string;
}): Promise<Buffer> {
  const bucket = getStorage().bucket(opts.bucket);
  const [contents] = await bucket.file(opts.gcsPath).download();
  return contents;
}

/**
 * Escape un nombre para uso dentro del Content-Disposition `filename="..."`
 * de RFC 6266. Backslash debe escaparse PRIMERO para no doble-escapar las
 * comillas ya re-escapadas. Caracteres de control y newlines se removen
 * (no son válidos en el quoted-string token de RFC 7230).
 */
export function escapeQuotedFilename(name: string): string {
  return (
    name
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip CTL chars (U+0000..U+001F + U+007F) — RFC 7230 prohíbe en quoted-string
      .replace(/[\u0000-\u001f\u007f]/g, '')
  );
}

export function computeSha256(body: Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return createHash('sha256').update(buf).digest('hex');
}
