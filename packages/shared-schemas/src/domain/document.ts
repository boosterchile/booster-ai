import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import {
  documentIdSchema,
  empresaIdSchema,
  tripIdSchema,
  userIdSchema,
} from '../primitives/ids.js';

/**
 * Tipos de documento que el sistema indexa. Ver ADR-007 "Gestión Documental
 * Obligatoria Chile". Los tipos `dte_*` requieren folio SII; los demás son
 * documentos internos generados por Booster o subidos por el usuario.
 *
 * Naming snake_case en español sin tildes (regla bilingüe CLAUDE.md).
 * Las siglas internacionales (DTE, ESG) se preservan en lowercase aquí
 * porque la columna SQL es enum y no hay convención formal del SII para
 * los nombres internos del marketplace.
 */
export const documentTypeSchema = z.enum([
  // DTEs SII (requieren folio + firma del proveedor acreditado)
  'dte_guia_despacho', // DTE Tipo 52 — Ley 19.983
  'dte_factura', // DTE Tipo 33 — Ley 20.727
  'dte_factura_exenta', // DTE Tipo 34
  // Documentos internos generados por Booster
  'carta_porte', // Ley 18.290 Art. 174
  'acta_entrega', // Conformidad de recepción + firma digital
  'certificado_esg', // Certificado de huella de carbono Booster
  // Capturas operacionales del driver
  'foto_pickup',
  'foto_delivery',
  'firma_receptor',
  'checklist_vehiculo',
  // Documentos externos subidos por el usuario
  'factura_externa', // ej. factura de combustible (entrada a OCR)
  'comprobante_pago',
  'otro',
]);

export type DocumentType = z.infer<typeof documentTypeSchema>;

/**
 * Subset de tipos sujetos a retention legal de 6 años (Object Lock GCS).
 * Estos NO pueden eliminarse ni siquiera por admin hasta `retention_until`.
 */
export const documentTypesWithLegalRetention: readonly DocumentType[] = [
  'dte_guia_despacho',
  'dte_factura',
  'dte_factura_exenta',
  'carta_porte',
  'acta_entrega',
] as const;

/**
 * Documento canónico. Una fila por archivo persistido en GCS.
 *
 * Notas:
 * - `gcs_path` es el path RELATIVO al bucket (ej. `dte/2026/05/guia-123.xml`).
 *   El bucket se infiere del config (`config.documentsBucket`).
 * - `sha256` permite verificar integridad post-download.
 * - `folio_sii` y `rut_emisor` solo aplican a los `dte_*`.
 * - `retention_until` se calcula al insertar como `emitted_at + 6 años`
 *   para los tipos en `documentTypesWithLegalRetention`; el resto es null.
 * - `metadata` JSONB queda libre para extender (ej. driver_id en fotos,
 *   geolocation en acta_entrega) sin migraciones por cada tipo.
 */
export const documentSchema = z.object({
  id: documentIdSchema,
  empresaId: empresaIdSchema,
  tripId: tripIdSchema.nullable(),
  type: documentTypeSchema,
  gcsPath: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i, 'sha256 inválido (debe ser hex 64 chars)'),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
  folioSii: z.string().max(40).nullable(),
  rutEmisor: rutSchema.nullable(),
  emittedByUserId: userIdSchema.nullable(),
  emittedAt: z.string().datetime(),
  retentionUntil: z.string().datetime().nullable(),
  piiRedactedCopy: z.boolean(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Document = z.infer<typeof documentSchema>;

/**
 * Input para registrar un documento ya subido a GCS. El llamador hace el
 * upload primero y luego invoca `indexarDocumento` con este shape.
 */
export const documentInsertSchema = documentSchema
  .omit({
    id: true,
    retentionUntil: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    metadata: z.record(z.unknown()).optional(),
  });

export type DocumentInsert = z.infer<typeof documentInsertSchema>;

/**
 * Filtros para querying. Todos opcionales; el indexer compone WHERE.
 */
export const documentQuerySchema = z.object({
  empresaId: empresaIdSchema.optional(),
  tripId: tripIdSchema.optional(),
  type: documentTypeSchema.optional(),
  types: z.array(documentTypeSchema).optional(),
  emittedFrom: z.string().datetime().optional(),
  emittedTo: z.string().datetime().optional(),
  limit: z.number().int().positive().max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

export type DocumentQuery = z.infer<typeof documentQuerySchema>;
