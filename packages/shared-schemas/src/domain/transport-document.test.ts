import { describe, expect, it } from 'vitest';
import {
  docTypeSchema,
  documentSourceSchema,
  extractionStatusSchema,
  transportDocumentManualEntryInputSchema,
  transportDocumentSchema,
} from './transport-document.js';

describe('docTypeSchema', () => {
  it('acepta los códigos SII y other', () => {
    for (const v of ['33', '34', '52', '56', '61', 'other']) {
      expect(docTypeSchema.parse(v)).toBe(v);
    }
  });

  it('rechaza un código fuera del enum', () => {
    expect(() => docTypeSchema.parse('99')).toThrow();
  });
});

describe('extractionStatusSchema', () => {
  it('acepta los 5 estados en español', () => {
    for (const v of ['pendiente', 'procesando', 'decodificado', 'ingreso_manual', 'fallido']) {
      expect(extractionStatusSchema.parse(v)).toBe(v);
    }
  });

  it('rechaza un estado en inglés (naming bilingüe)', () => {
    expect(() => extractionStatusSchema.parse('pending')).toThrow();
  });
});

describe('documentSourceSchema', () => {
  it('acepta los 3 orígenes', () => {
    for (const v of ['pdf_upload', 'photo_upload', 'xml_intercambio']) {
      expect(documentSourceSchema.parse(v)).toBe(v);
    }
  });

  it('rechaza un origen desconocido', () => {
    expect(() => documentSourceSchema.parse('email_upload')).toThrow();
  });
});

describe('transportDocumentSchema', () => {
  const base = {
    id: 'b3b8c1d2-0000-4000-8000-000000000001',
    viaje_id: 'b3b8c1d2-0000-4000-8000-000000000002',
    file_path: 'transport-documents/abc/doc.pdf',
    file_mime: 'application/pdf',
    doc_type: '52' as const,
    folio: null,
    rut_emisor: null,
    razon_social_emisor: null,
    rut_receptor: null,
    razon_social_receptor: null,
    fecha_emision: null,
    monto_total: null,
    ted_raw: null,
    ted_signature_valid: null,
    extraction_status: 'pendiente' as const,
    source: 'pdf_upload' as const,
    retention_until: null,
    uploaded_by: 'b3b8c1d2-0000-4000-8000-000000000003',
    creado_en: '2026-06-18T10:00:00.000Z',
    actualizado_en: '2026-06-18T10:00:00.000Z',
  };

  it('parsea una fila recién subida (pendiente, campos TED null)', () => {
    const parsed = transportDocumentSchema.parse(base);
    expect(parsed.extraction_status).toBe('pendiente');
    expect(parsed.folio).toBeNull();
    expect(parsed.ted_signature_valid).toBeNull();
  });

  it('parsea una fila decodificada con campos del <DD>', () => {
    const parsed = transportDocumentSchema.parse({
      ...base,
      doc_type: '52',
      folio: '12345',
      rut_emisor: '76123456-7',
      rut_receptor: '77000000-0',
      razon_social_receptor: 'Generador Carga SpA',
      fecha_emision: '2026-06-15',
      monto_total: '1500000.00',
      ted_raw: '<TED>...</TED>',
      ted_signature_valid: true,
      extraction_status: 'decodificado',
      retention_until: '2032-06-15',
    });
    expect(parsed.monto_total).toBe('1500000.00');
    expect(parsed.ted_signature_valid).toBe(true);
  });

  it('rechaza extraction_status fuera del enum', () => {
    expect(() => transportDocumentSchema.parse({ ...base, extraction_status: 'done' })).toThrow();
  });

  it('uploaded_by puede ser null', () => {
    const parsed = transportDocumentSchema.parse({ ...base, uploaded_by: null });
    expect(parsed.uploaded_by).toBeNull();
  });
});

describe('transportDocumentManualEntryInputSchema', () => {
  it('acepta una corrección parcial', () => {
    const parsed = transportDocumentManualEntryInputSchema.parse({
      doc_type: '52',
      folio: '999',
      fecha_emision: '2026-06-15',
      monto_total: '1000000.00',
    });
    expect(parsed.folio).toBe('999');
  });

  it('rechaza un body vacío (al menos un campo)', () => {
    expect(() => transportDocumentManualEntryInputSchema.parse({})).toThrow();
  });

  it('rechaza fecha_emision con formato no ISO', () => {
    expect(() =>
      transportDocumentManualEntryInputSchema.parse({ fecha_emision: '15-06-2026' }),
    ).toThrow();
  });

  it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2026-06-00', '2026-04-31', '2026-02-29'])(
    'rechaza fecha_emision ISO-válida pero día imposible (%s) — evita el 500/poison pill',
    (fe) => {
      expect(() => transportDocumentManualEntryInputSchema.parse({ fecha_emision: fe })).toThrow();
    },
  );

  it('acepta un 29 de febrero REAL de año bisiesto (2024-02-29)', () => {
    const parsed = transportDocumentManualEntryInputSchema.parse({ fecha_emision: '2024-02-29' });
    expect(parsed.fecha_emision).toBe('2024-02-29');
  });

  it('rechaza monto_total con más de 2 decimales', () => {
    expect(() =>
      transportDocumentManualEntryInputSchema.parse({ monto_total: '1000.999' }),
    ).toThrow();
  });
});
