import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api-client.js';
import {
  DOC_TYPE_LABEL,
  EXTRACTION_STATUS_LABEL,
  canWriteTransportDocuments,
  getTransportDocument,
  humanizeTransportDocumentError,
  isAllowedTransportDocumentFile,
  listTransportDocuments,
  needsManualEntry,
  openTransportDocumentDownload,
  submitManualEntry,
  uploadTransportDocument,
} from './transport-documents-api.js';

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('canWriteTransportDocuments', () => {
  it('dueño/admin/despachador sí', () => {
    expect(canWriteTransportDocuments('dueno')).toBe(true);
    expect(canWriteTransportDocuments('admin')).toBe(true);
    expect(canWriteTransportDocuments('despachador')).toBe(true);
  });

  it('conductor/visualizador/ausente no', () => {
    expect(canWriteTransportDocuments('conductor')).toBe(false);
    expect(canWriteTransportDocuments('visualizador')).toBe(false);
    expect(canWriteTransportDocuments(null)).toBe(false);
    expect(canWriteTransportDocuments(undefined)).toBe(false);
  });
});

describe('labels vos', () => {
  it('status en español humano', () => {
    expect(EXTRACTION_STATUS_LABEL.pendiente).toBe('Pendiente');
    expect(EXTRACTION_STATUS_LABEL.fallido).toBe('Falló la lectura');
    expect(EXTRACTION_STATUS_LABEL.ingreso_manual).toBe('Ingreso manual');
  });

  it('doc type SII', () => {
    expect(DOC_TYPE_LABEL['52']).toBe('Guía de despacho 52');
    expect(DOC_TYPE_LABEL['33']).toBe('Factura 33');
  });
});

describe('needsManualEntry', () => {
  it('fallido, pendiente y procesando sí; decodificado/manual no', () => {
    expect(needsManualEntry('fallido')).toBe(true);
    expect(needsManualEntry('pendiente')).toBe(true);
    expect(needsManualEntry('procesando')).toBe(true);
    expect(needsManualEntry('decodificado')).toBe(false);
    expect(needsManualEntry('ingreso_manual')).toBe(false);
  });
});

describe('isAllowedTransportDocumentFile', () => {
  it('PDF/JPEG/PNG ok', () => {
    expect(
      isAllowedTransportDocumentFile(new File(['x'], 'a.pdf', { type: 'application/pdf' })).ok,
    ).toBe(true);
    expect(
      isAllowedTransportDocumentFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' })).ok,
    ).toBe(true);
    expect(isAllowedTransportDocumentFile(new File(['x'], 'a.png', { type: 'image/png' })).ok).toBe(
      true,
    );
  });

  it('webp rechazado', () => {
    expect(
      isAllowedTransportDocumentFile(new File(['x'], 'a.webp', { type: 'image/webp' })),
    ).toEqual({ ok: false, reason: 'mime' });
  });

  it('>15 MB rechazado', () => {
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'a.pdf', {
      type: 'application/pdf',
    });
    expect(isAllowedTransportDocumentFile(big)).toEqual({ ok: false, reason: 'size' });
  });
});

describe('humanizeTransportDocumentError', () => {
  it('503 storage_unavailable → copy contratado', () => {
    expect(humanizeTransportDocumentError(new ApiError(503, 'storage_unavailable', null))).toBe(
      'El archivo no se pudo guardar (storage). Reintentá más tarde.',
    );
  });

  it('mime / size / write role / forbidden', () => {
    expect(humanizeTransportDocumentError(new ApiError(400, 'mime_not_allowed', null))).toMatch(
      /PDF, JPEG o PNG/,
    );
    expect(humanizeTransportDocumentError(new ApiError(413, 'file_too_large', null))).toMatch(
      /15 MB/,
    );
    expect(humanizeTransportDocumentError(new ApiError(403, 'write_role_required', null))).toMatch(
      /Pedile/,
    );
    expect(humanizeTransportDocumentError(new ApiError(403, 'forbidden', null))).toMatch(
      /No tenés/,
    );
    expect(humanizeTransportDocumentError(new ApiError(400, 'mime_mismatch', null))).toMatch(
      /PDF, JPEG o PNG/,
    );
    expect(humanizeTransportDocumentError(new ApiError(400, 'file_missing', null))).toMatch(
      /Elegí un archivo/,
    );
    expect(humanizeTransportDocumentError(new ApiError(404, 'trip_not_found', null))).toMatch(
      /No encontramos/,
    );
    expect(humanizeTransportDocumentError(new ApiError(500, 'persist_failed', null))).toMatch(
      /No se pudo guardar/,
    );
    expect(humanizeTransportDocumentError(new ApiError(500, 'upload_failed', null))).toMatch(
      /storage/,
    );
    expect(humanizeTransportDocumentError(new ApiError(500, 'invalid_response', null))).toMatch(
      /no se pudo leer/,
    );
  });

  it('error desconocido → genérico vos', () => {
    expect(humanizeTransportDocumentError(new Error('boom'))).toBe(
      'Algo salió mal. Reintentá más tarde.',
    );
  });
});

describe('listTransportDocuments', () => {
  it('mapea camelCase Drizzle al modelo UI', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      documents: [
        {
          id: DOC_ID,
          docType: '52',
          folio: '100',
          fileMime: 'application/pdf',
          extractionStatus: 'pendiente',
          source: 'pdf_upload',
          fechaEmision: null,
          montoTotal: null,
          retentionUntil: null,
          createdAt: '2026-09-21T04:00:00.000Z',
        },
      ],
    });
    const docs = await listTransportDocuments(TRIP_ID);
    expect(api.get).toHaveBeenCalledWith(`/transport-orders/${TRIP_ID}/documents`);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.extractionStatus).toBe('pendiente');
    expect(docs[0]?.docType).toBe('52');
  });

  it('respuesta inválida del listado → ApiError invalid_response', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ documents: [{ id: 'no-uuid' }] });
    await expect(listTransportDocuments(TRIP_ID)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('uploadTransportDocument', () => {
  it('POST multipart y mapea snake_case 202', async () => {
    const postForm = vi.spyOn(api, 'postForm').mockResolvedValueOnce({
      document_id: DOC_ID,
      extraction_status: 'pendiente',
    });
    const file = new File(['%PDF'], 'guia.pdf', { type: 'application/pdf' });
    const res = await uploadTransportDocument(TRIP_ID, file);
    expect(res).toEqual({ documentId: DOC_ID, extractionStatus: 'pendiente' });
    expect(postForm).toHaveBeenCalledWith(
      `/transport-orders/${TRIP_ID}/documents`,
      expect.any(FormData),
    );
    const form = postForm.mock.calls[0]?.[1] as FormData;
    expect(form.get('file')).toBe(file);
  });

  it('mime no permitido no pega al API', async () => {
    const postForm = vi.spyOn(api, 'postForm');
    const file = new File(['x'], 'a.gif', { type: 'image/gif' });
    await expect(uploadTransportDocument(TRIP_ID, file)).rejects.toMatchObject({
      code: 'mime_not_allowed',
    });
    expect(postForm).not.toHaveBeenCalled();
  });

  it('archivo >15 MB no pega al API', async () => {
    const postForm = vi.spyOn(api, 'postForm');
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'a.pdf', {
      type: 'application/pdf',
    });
    await expect(uploadTransportDocument(TRIP_ID, big)).rejects.toMatchObject({
      code: 'file_too_large',
    });
    expect(postForm).not.toHaveBeenCalled();
  });
});

describe('getTransportDocument + download', () => {
  it('mapea snake_case del detalle', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      document: {
        id: DOC_ID,
        viaje_id: TRIP_ID,
        doc_type: '33',
        folio: '9',
        file_mime: 'application/pdf',
        rut_emisor: '76.000.000-0',
        razon_social_emisor: null,
        rut_receptor: null,
        razon_social_receptor: null,
        fecha_emision: '2026-09-01',
        monto_total: '1000.00',
        ted_signature_valid: null,
        extraction_status: 'decodificado',
        source: 'pdf_upload',
        retention_until: '2032-09-01',
        creado_en: '2026-09-21T04:00:00.000Z',
      },
      download_url: 'https://signed.example/doc.pdf',
    });
    const d = await getTransportDocument(DOC_ID);
    expect(d.viajeId).toBe(TRIP_ID);
    expect(d.docType).toBe('33');
    expect(d.downloadUrl).toContain('signed.example');
  });

  it('abre window.open con la signed URL', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      document: {
        id: DOC_ID,
        viaje_id: TRIP_ID,
        doc_type: 'other',
        folio: null,
        file_mime: 'application/pdf',
        rut_emisor: null,
        razon_social_emisor: null,
        rut_receptor: null,
        razon_social_receptor: null,
        fecha_emision: null,
        monto_total: null,
        ted_signature_valid: null,
        extraction_status: 'pendiente',
        source: 'pdf_upload',
        retention_until: null,
        creado_en: '2026-09-21T04:00:00.000Z',
      },
      download_url: 'https://signed.example/x.pdf',
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openTransportDocumentDownload(DOC_ID);
    expect(open).toHaveBeenCalledWith('https://signed.example/x.pdf', '_blank', 'noopener');
  });

  it('download_url null → 503 storage', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      document: {
        id: DOC_ID,
        viaje_id: TRIP_ID,
        doc_type: 'other',
        folio: null,
        file_mime: 'application/pdf',
        rut_emisor: null,
        razon_social_emisor: null,
        rut_receptor: null,
        razon_social_receptor: null,
        fecha_emision: null,
        monto_total: null,
        ted_signature_valid: null,
        extraction_status: 'pendiente',
        source: 'pdf_upload',
        retention_until: null,
        creado_en: '2026-09-21T04:00:00.000Z',
      },
      download_url: null,
    });
    await expect(openTransportDocumentDownload(DOC_ID)).rejects.toMatchObject({
      code: 'storage_unavailable',
    });
  });
});

describe('submitManualEntry', () => {
  it('POST json snake_case y mapea ingreso_manual', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({
      ok: true,
      document_id: DOC_ID,
      extraction_status: 'ingreso_manual',
      retention_until: '2032-09-01',
    });
    const res = await submitManualEntry(DOC_ID, { doc_type: '52', folio: '100' });
    expect(res.extractionStatus).toBe('ingreso_manual');
    expect(post).toHaveBeenCalledWith(`/documents/${DOC_ID}/manual-entry`, {
      doc_type: '52',
      folio: '100',
    });
  });
});
