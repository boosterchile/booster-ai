import { z } from 'zod';
import { tripRequestIdSchema, userIdSchema, uuidSchema } from '../primitives/ids.js';

/**
 * TransportDocument = documento tributario de un tercero (Guía de Despacho
 * DTE 52, Factura 33, etc.) que ampara la carga de una orden de transporte
 * (`viajes`). Booster lo **recibe y archiva** — NO emite ni se integra con
 * el SII (ADR-069 / ADR-070, frente F4).
 *
 * Naming bilingüe (ver CLAUDE.md): la tabla SQL es `documentos_transporte`,
 * el export TS es `transportDocuments` / `TransportDocumentRow`. Los valores
 * de enum van en español snake_case sin tildes, EXCEPTO `doc_type`, cuyos
 * valores son los códigos literales del SII (`33`/`34`/`52`/`56`/`61`) más
 * `other` para tipos no esperados.
 *
 * El DDL Drizzle canónico vive en `apps/api/src/db/schema.ts` y debe tener
 * paridad 1:1 de campos/enums con este schema (test de paridad).
 */

/**
 * Tipo de documento tributario. Los códigos numéricos son los del SII
 * (33=Factura electrónica, 34=Factura exenta, 52=Guía de Despacho,
 * 56=Nota de Débito, 61=Nota de Crédito). `other` cubre tipos no esperados
 * sin romper el insert.
 */
export const docTypeSchema = z.enum(['33', '34', '52', '56', '61', 'other']);
export type DocType = z.infer<typeof docTypeSchema>;

/**
 * Estado de extracción del TED. `pendiente` al subir; el worker (4b) lo
 * mueve a `procesando` → `decodificado` o `fallido`. `ingreso_manual` lo
 * setea el endpoint de corrección manual cuando el usuario completa los
 * campos a mano.
 */
export const extractionStatusSchema = z.enum([
  'pendiente',
  'procesando',
  'decodificado',
  'ingreso_manual',
  'fallido',
]);
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;

/**
 * Origen del documento. `pdf_upload`/`photo_upload` desde el endpoint de
 * subida (4a); `xml_intercambio` reservado para el canal de Intercambio
 * entre Contribuyentes (stub en 4c).
 */
export const documentSourceSchema = z.enum(['pdf_upload', 'photo_upload', 'xml_intercambio']);
export type DocumentSource = z.infer<typeof documentSourceSchema>;

/**
 * Schema de dominio canónico de un documento de transporte. Paridad 1:1 con
 * la tabla `documentos_transporte`. Campos nullable hasta que el worker (4b)
 * o el manual-entry (4a) los pueblen.
 */
export const transportDocumentSchema = z.object({
  id: uuidSchema,
  viaje_id: tripRequestIdSchema,
  file_path: z.string().min(1),
  file_mime: z.string().min(1),
  doc_type: docTypeSchema,
  folio: z.string().nullable(),
  rut_emisor: z.string().nullable(),
  razon_social_emisor: z.string().nullable(),
  rut_receptor: z.string().nullable(),
  razon_social_receptor: z.string().nullable(),
  /** ISO date (YYYY-MM-DD) del `<DD><FE>`. Insumo de `retention_until`. */
  fecha_emision: z.string().nullable(),
  /** Monto total como string decimal (numeric(14,2) en SQL). */
  monto_total: z.string().nullable(),
  ted_raw: z.string().nullable(),
  /** NULL = firma no validada (flag off); true/false = validada. */
  ted_signature_valid: z.boolean().nullable(),
  extraction_status: extractionStatusSchema,
  source: documentSourceSchema,
  /** ISO date (YYYY-MM-DD) hasta el cual se conserva el documento. */
  retention_until: z.string().nullable(),
  uploaded_by: userIdSchema.nullable(),
  creado_en: z.string().datetime(),
  actualizado_en: z.string().datetime(),
});
export type TransportDocument = z.infer<typeof transportDocumentSchema>;

/**
 * Input del endpoint de corrección manual (`POST /documents/:id/manual-entry`).
 * Todos los campos opcionales: el usuario corrige solo los que conoce. Al
 * menos uno debe venir (validado en el handler / refine).
 */
export const transportDocumentManualEntryInputSchema = z
  .object({
    doc_type: docTypeSchema.optional(),
    folio: z.string().min(1).max(40).optional(),
    rut_emisor: z.string().min(1).max(20).optional(),
    razon_social_emisor: z.string().min(1).max(200).optional(),
    rut_receptor: z.string().min(1).max(20).optional(),
    razon_social_receptor: z.string().min(1).max(200).optional(),
    /** ISO date YYYY-MM-DD. */
    fecha_emision: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_emision debe ser ISO date YYYY-MM-DD')
      .optional(),
    /** Monto total como string decimal. */
    monto_total: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'monto_total debe ser decimal con hasta 2 decimales')
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'al menos un campo debe ser provisto',
  });
export type TransportDocumentManualEntryInput = z.infer<
  typeof transportDocumentManualEntryInputSchema
>;
