/**
 * Cliente tipado del repositorio documental de transporte (F4-4a).
 *
 * Las respuestas mezclan camelCase (GET lista, Drizzle) y snake_case
 * (upload, detalle, manual-entry). Cada boundary pasa por Zod; el UI
 * consume un modelo camelCase canónico.
 */

import {
  type DocType,
  type DocumentSource,
  type ExtractionStatus,
  type TransportDocumentManualEntryInput,
  docTypeSchema,
  documentSourceSchema,
  extractionStatusSchema,
  transportDocumentManualEntryInputSchema,
} from '@booster-ai/shared-schemas';
import { z } from 'zod';
import { ApiError, api } from './api-client.js';

export const TRANSPORT_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
export const TRANSPORT_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
export type TransportDocumentMime = (typeof TRANSPORT_DOCUMENT_MIME_TYPES)[number];

export const WRITE_TRANSPORT_DOCUMENT_ROLES = ['dueno', 'admin', 'despachador'] as const;

export function canWriteTransportDocuments(role: string | null | undefined): boolean {
  return role != null && (WRITE_TRANSPORT_DOCUMENT_ROLES as readonly string[]).includes(role);
}

/** ISO datetime o date string que llega por JSON (nunca `Date` en fetch). */
const isoish = z.string().min(1);

/** GET /transport-orders/:id/documents — camelCase Drizzle. */
const listItemRawSchema = z.object({
  id: z.string().uuid(),
  docType: docTypeSchema,
  folio: z.string().nullable(),
  fileMime: z.string().min(1),
  extractionStatus: extractionStatusSchema,
  source: documentSourceSchema,
  fechaEmision: z.string().nullable(),
  montoTotal: z.string().nullable(),
  retentionUntil: z.string().nullable(),
  createdAt: isoish,
});

const listResponseSchema = z.object({
  documents: z.array(listItemRawSchema),
});

export interface TransportDocumentListItem {
  id: string;
  docType: DocType;
  folio: string | null;
  fileMime: string;
  extractionStatus: ExtractionStatus;
  source: DocumentSource;
  fechaEmision: string | null;
  montoTotal: string | null;
  retentionUntil: string | null;
  createdAt: string;
}

const uploadResponseSchema = z.object({
  document_id: z.string().uuid(),
  extraction_status: extractionStatusSchema,
});

export interface TransportDocumentUploadResult {
  documentId: string;
  extractionStatus: ExtractionStatus;
}

const detailResponseSchema = z.object({
  document: z.object({
    id: z.string().uuid(),
    viaje_id: z.string().uuid(),
    doc_type: docTypeSchema,
    folio: z.string().nullable(),
    file_mime: z.string().min(1),
    rut_emisor: z.string().nullable(),
    razon_social_emisor: z.string().nullable(),
    rut_receptor: z.string().nullable(),
    razon_social_receptor: z.string().nullable(),
    fecha_emision: z.string().nullable(),
    monto_total: z.string().nullable(),
    ted_signature_valid: z.boolean().nullable(),
    extraction_status: extractionStatusSchema,
    source: documentSourceSchema,
    retention_until: z.string().nullable(),
    creado_en: isoish,
  }),
  download_url: z.string().nullable(),
});

export interface TransportDocumentDetail {
  id: string;
  viajeId: string;
  docType: DocType;
  folio: string | null;
  fileMime: string;
  rutEmisor: string | null;
  razonSocialEmisor: string | null;
  rutReceptor: string | null;
  razonSocialReceptor: string | null;
  fechaEmision: string | null;
  montoTotal: string | null;
  tedSignatureValid: boolean | null;
  extractionStatus: ExtractionStatus;
  source: DocumentSource;
  retentionUntil: string | null;
  creadoEn: string;
  downloadUrl: string | null;
}

const manualEntryResponseSchema = z.object({
  ok: z.literal(true),
  document_id: z.string().uuid(),
  extraction_status: z.literal('ingreso_manual'),
  retention_until: z.string().nullable(),
});

export interface TransportDocumentManualEntryResult {
  documentId: string;
  extractionStatus: 'ingreso_manual';
  retentionUntil: string | null;
}

function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown, label: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      500,
      'invalid_response',
      parsed.error.flatten(),
      `Respuesta inválida (${label})`,
    );
  }
  return parsed.data;
}

export async function listTransportDocuments(tripId: string): Promise<TransportDocumentListItem[]> {
  const raw = await api.get<unknown>(`/transport-orders/${tripId}/documents`);
  const parsed = parseOrThrow(listResponseSchema, raw, 'list');
  return parsed.documents.map((d) => ({
    id: d.id,
    docType: d.docType,
    folio: d.folio,
    fileMime: d.fileMime,
    extractionStatus: d.extractionStatus,
    source: d.source,
    fechaEmision: d.fechaEmision,
    montoTotal: d.montoTotal,
    retentionUntil: d.retentionUntil,
    createdAt: d.createdAt,
  }));
}

export function isAllowedTransportDocumentFile(file: File): {
  ok: boolean;
  reason: 'mime' | 'size' | null;
} {
  const mimeOk = (TRANSPORT_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type);
  if (!mimeOk) {
    return { ok: false, reason: 'mime' };
  }
  if (file.size > TRANSPORT_DOCUMENT_MAX_BYTES) {
    return { ok: false, reason: 'size' };
  }
  return { ok: true, reason: null };
}

export async function uploadTransportDocument(
  tripId: string,
  file: File,
): Promise<TransportDocumentUploadResult> {
  const check = isAllowedTransportDocumentFile(file);
  if (!check.ok) {
    if (check.reason === 'size') {
      throw new ApiError(413, 'file_too_large', null, 'file_too_large');
    }
    throw new ApiError(400, 'mime_not_allowed', null, 'mime_not_allowed');
  }
  const form = new FormData();
  form.append('file', file);
  const raw = await api.postForm<unknown>(`/transport-orders/${tripId}/documents`, form);
  const parsed = parseOrThrow(uploadResponseSchema, raw, 'upload');
  return { documentId: parsed.document_id, extractionStatus: parsed.extraction_status };
}

export async function getTransportDocument(documentId: string): Promise<TransportDocumentDetail> {
  const raw = await api.get<unknown>(`/documents/${documentId}`);
  const parsed = parseOrThrow(detailResponseSchema, raw, 'detail');
  const d = parsed.document;
  return {
    id: d.id,
    viajeId: d.viaje_id,
    docType: d.doc_type,
    folio: d.folio,
    fileMime: d.file_mime,
    rutEmisor: d.rut_emisor,
    razonSocialEmisor: d.razon_social_emisor,
    rutReceptor: d.rut_receptor,
    razonSocialReceptor: d.razon_social_receptor,
    fechaEmision: d.fecha_emision,
    montoTotal: d.monto_total,
    tedSignatureValid: d.ted_signature_valid,
    extractionStatus: d.extraction_status,
    source: d.source,
    retentionUntil: d.retention_until,
    creadoEn: d.creado_en,
    downloadUrl: parsed.download_url,
  };
}

export async function submitManualEntry(
  documentId: string,
  input: TransportDocumentManualEntryInput,
): Promise<TransportDocumentManualEntryResult> {
  const body = transportDocumentManualEntryInputSchema.parse(input);
  const raw = await api.post<unknown>(`/documents/${documentId}/manual-entry`, body);
  const parsed = parseOrThrow(manualEntryResponseSchema, raw, 'manual-entry');
  return {
    documentId: parsed.document_id,
    extractionStatus: parsed.extraction_status,
    retentionUntil: parsed.retention_until,
  };
}

export async function openTransportDocumentDownload(documentId: string): Promise<void> {
  const detail = await getTransportDocument(documentId);
  if (!detail.downloadUrl) {
    throw new ApiError(503, 'storage_unavailable', null, 'storage_unavailable');
  }
  window.open(detail.downloadUrl, '_blank', 'noopener');
}

export const EXTRACTION_STATUS_LABEL: Record<ExtractionStatus, string> = {
  pendiente: 'Pendiente',
  procesando: 'Procesando',
  decodificado: 'Decodificado',
  ingreso_manual: 'Ingreso manual',
  fallido: 'Falló la lectura',
};

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  '33': 'Factura 33',
  '34': 'Factura exenta 34',
  '52': 'Guía de despacho 52',
  '56': 'Nota de débito 56',
  '61': 'Nota de crédito 61',
  other: 'Otro',
};

/** Statuses where ops still needs to complete fields by hand. */
export function needsManualEntry(status: ExtractionStatus): boolean {
  return status === 'fallido' || status === 'pendiente' || status === 'procesando';
}

/**
 * Copy vos para errores del repositorio documental. El 503 de storage
 * es el mensaje contratado en el spec (no crash).
 */
export function humanizeTransportDocumentError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === 'storage_unavailable' || err.code === 'upload_failed') {
      return 'El archivo no se pudo guardar (storage). Reintentá más tarde.';
    }
    if (err.code === 'mime_not_allowed' || err.code === 'mime_mismatch') {
      return 'Ese archivo no sirve. Subí un PDF, JPEG o PNG.';
    }
    if (err.code === 'file_too_large' || err.status === 413) {
      return 'El archivo pesa de más (máximo 15 MB).';
    }
    if (err.code === 'write_role_required') {
      return 'Tu rol no puede subir documentos. Pedile a un dueño, admin o despachador.';
    }
    if (err.code === 'file_missing' || err.code === 'multipart_required') {
      return 'Elegí un archivo y reintentá.';
    }
    if (err.code === 'trip_not_found' || err.code === 'document_not_found') {
      return 'No encontramos ese viaje o documento.';
    }
    if (err.code === 'forbidden') {
      return 'No tenés permiso para este viaje.';
    }
    if (err.code === 'persist_failed' || err.code === 'update_failed') {
      return 'No se pudo guardar. Reintentá más tarde.';
    }
    if (err.code === 'invalid_response') {
      return 'La respuesta del servidor no se pudo leer. Reintentá más tarde.';
    }
  }
  return 'Algo salió mal. Reintentá más tarde.';
}
