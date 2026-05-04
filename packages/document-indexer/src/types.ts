/**
 * Tipos públicos del package. El registro `Document` matchea la tabla
 * `documentos` declarada en ADR-007 § "Postgres - Índice y metadata".
 *
 * Decisión de diseño: el package es **agnóstico al backend** — no
 * importa Drizzle ni `@google-cloud/storage`. El caller implementa las
 * interfaces `DocumentRepo` y `BlobStore` con su stack real, y el
 * package solo orquesta la lógica.
 */

import { z } from 'zod';

/**
 * Tipos canónicos de documentos manejados por la plataforma. Matchea
 * (extiende) el enum del schema Drizzle. Si agregás un tipo nuevo:
 *   1. Sumar acá.
 *   2. Sumar en el enum SQL (`tipo_documento`).
 *   3. Definir el path GCS en `gcsPathFor()`.
 */
export const documentTypeSchema = z.enum([
  'dte_52', // Guía de Despacho
  'dte_33', // Factura Afecta
  'dte_34', // Factura Exenta
  'carta_porte', // Carta de Porte Ley 18.290
  'acta_entrega', // Conformidad de recepción
  'foto_pickup', // Foto pre-pickup
  'foto_delivery', // Foto post-delivery
  'firma_entrega', // Firma táctil del receptor
  'checklist_vehiculo', // Inspección pre-viaje
  'factura_combustible', // Externo, post-OCR
  'certificado_esg', // Certificado de carbono Booster
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const documentRecordSchema = z
  .object({
    id: z.string().uuid(),
    tripId: z.string().uuid().nullable(),
    type: documentTypeSchema,
    /**
     * Path completo en Cloud Storage (sin gs://, sin bucket — solo el
     * objectName). El bucket lo conoce el caller via env var.
     */
    gcsPath: z.string().min(1),
    /** SHA-256 hex del contenido del documento — para integrity check. */
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    /**
     * Folio SII si aplica (DTE 52/33/34). Null para los otros tipos.
     */
    folioSii: z.string().nullable(),
    /**
     * UUID del user que originó la emisión. Para audit + filtrado por
     * empresa via join de `users → empresas`.
     */
    emittedByUserId: z.string().uuid().nullable(),
    emittedAt: z.date(),
    /**
     * `emittedAt + 6 años` (Ley 18.290 + SII). El job de retention
     * cleanup compara contra `now()` para decidir delete.
     */
    retentionUntil: z.date(),
    /**
     * `true` si existe una versión PII-redactada del documento (para
     * compartir fuera del proyecto, ej. con auditor externo). El path
     * de la versión redactada se infiere por convención:
     * `<gcsPath>.redacted.pdf`.
     */
    piiRedactedCopyExists: z.boolean().default(false),
    sizeBytes: z.number().int().positive(),
  })
  .strict();
export type DocumentRecord = z.infer<typeof documentRecordSchema>;

/**
 * Filtros para listar documentos. Todos opcionales; sin filtros lista
 * todo (el caller debería autorizar previamente).
 */
export const listDocumentsFilterSchema = z
  .object({
    tripId: z.string().uuid().optional(),
    type: documentTypeSchema.optional(),
    /** Filtrar por documentos emitidos en o después de esta fecha. */
    emittedAfter: z.date().optional(),
    /** Filtrar por documentos emitidos antes de esta fecha. */
    emittedBefore: z.date().optional(),
    /** Limit de resultados. Default 100, max 1000. */
    limit: z.number().int().min(1).max(1000).default(100),
    /** Offset para paginación. Default 0. */
    offset: z.number().int().min(0).default(0),
  })
  .strict();
export type ListDocumentsFilter = z.infer<typeof listDocumentsFilterSchema>;

/**
 * Información para registrar un documento nuevo en el índice.
 * Se compone con `emittedAt` + cálculo de `retentionUntil`.
 */
export const indexDocumentInputSchema = z
  .object({
    tripId: z.string().uuid().nullable(),
    type: documentTypeSchema,
    gcsPath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    folioSii: z.string().nullable().default(null),
    emittedByUserId: z.string().uuid().nullable(),
    sizeBytes: z.number().int().positive(),
    /**
     * `emittedAt` opcional — si no se da, usa `new Date()`. Útil para
     * tests con clock fijo.
     */
    emittedAt: z.date().optional(),
  })
  .strict();
export type IndexDocumentInput = z.infer<typeof indexDocumentInputSchema>;

/**
 * Backend abstracto de persistencia. El caller (apps/document-service)
 * lo implementa con Drizzle.
 */
export interface DocumentRepo {
  insert(input: DocumentRecord): Promise<void>;
  findById(id: string): Promise<DocumentRecord | null>;
  list(filter: ListDocumentsFilter): Promise<DocumentRecord[]>;
  /**
   * Documentos cuya `retentionUntil` ya venció. Para el job de cleanup.
   */
  findExpired(asOf: Date, limit: number): Promise<DocumentRecord[]>;
  delete(id: string): Promise<void>;
}

/**
 * Backend abstracto de Cloud Storage. El caller lo implementa con
 * `@google-cloud/storage` (o un mock en tests).
 */
export interface BlobStore {
  /**
   * URL firmada para download/read del objeto. Expiración en
   * segundos. El caller decide la lib (default 900s = 15 min según
   * ADR-007 — pero el package no asume default, es responsabilidad
   * del caller pasar el TTL).
   */
  getSignedReadUrl(args: {
    objectName: string;
    expiresInSeconds: number;
  }): Promise<string>;
  /**
   * URL firmada para upload (PUT). Misma firma. El caller la usa para
   * ingesta directa cliente → GCS sin pasar por backend (e.g. fotos
   * pesadas del driver).
   */
  getSignedUploadUrl(args: {
    objectName: string;
    expiresInSeconds: number;
    contentType: string;
  }): Promise<string>;
  /**
   * Existencia + tamaño del objeto. Para verificar post-upload que el
   * cliente realmente subió antes de indexar.
   */
  statObject(objectName: string): Promise<{ sizeBytes: number } | null>;
  /**
   * Delete del objeto. NO se debe llamar si tiene retention lock activo
   * (Cloud Storage retornará 403). El job de cleanup chequea
   * `retentionUntil` antes.
   */
  deleteObject(objectName: string): Promise<void>;
}
