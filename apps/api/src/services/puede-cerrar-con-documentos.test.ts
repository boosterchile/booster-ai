import { describe, expect, it } from 'vitest';
import {
  type DocumentoParaCierre,
  type FlagsCierreDocumental,
  puedeCerrarConDocumentos,
} from './puede-cerrar-con-documentos.js';

const corte = new Date('2026-06-18T00:00:00.000Z');

const flagsBase: FlagsCierreDocumental = {
  requireDocumentToClose: true,
  requireTedDecode: false,
  requireDocumentSince: corte,
};

const docPendiente: DocumentoParaCierre = { extractionStatus: 'pendiente' };
const docDecodificado: DocumentoParaCierre = { extractionStatus: 'decodificado' };
const docFallido: DocumentoParaCierre = { extractionStatus: 'fallido' };

describe('puedeCerrarConDocumentos', () => {
  it('permite cerrar cuando el flag está OFF, sin importar documentos', () => {
    const r = puedeCerrarConDocumentos({
      flags: { ...flagsBase, requireDocumentToClose: false },
      tripCreatedAt: new Date('2026-07-01T00:00:00.000Z'),
      documentos: [],
    });
    expect(r.puedeCerrar).toBe(true);
  });

  it('EXENTA órdenes legacy creadas antes de la fecha de corte (flag ON, 0 docs)', () => {
    const r = puedeCerrarConDocumentos({
      flags: flagsBase,
      tripCreatedAt: new Date('2026-06-01T00:00:00.000Z'),
      documentos: [],
    });
    expect(r.puedeCerrar).toBe(true);
    expect(r.razon).toBe('orden_legacy_exenta');
  });

  it('exige documento a una orden creada en la fecha de corte exacta (>=)', () => {
    const r = puedeCerrarConDocumentos({
      flags: flagsBase,
      tripCreatedAt: corte,
      documentos: [],
    });
    expect(r.puedeCerrar).toBe(false);
    expect(r.razon).toBe('documento_requerido');
  });

  it('rechaza el cierre si la orden es nueva y no tiene documentos', () => {
    const r = puedeCerrarConDocumentos({
      flags: flagsBase,
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [],
    });
    expect(r.puedeCerrar).toBe(false);
    expect(r.razon).toBe('documento_requerido');
  });

  it('permite cerrar con >=1 documento subido aunque el TED NO decodifique (pendiente)', () => {
    const r = puedeCerrarConDocumentos({
      flags: flagsBase,
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [docPendiente],
    });
    expect(r.puedeCerrar).toBe(true);
  });

  it('permite cerrar con un documento fallido (cierre flexible)', () => {
    const r = puedeCerrarConDocumentos({
      flags: flagsBase,
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [docFallido],
    });
    expect(r.puedeCerrar).toBe(true);
  });

  it('con REQUIRE_TED_DECODE=true exige al menos un documento decodificado', () => {
    const flags = { ...flagsBase, requireTedDecode: true };
    const sinDecode = puedeCerrarConDocumentos({
      flags,
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [docPendiente, docFallido],
    });
    expect(sinDecode.puedeCerrar).toBe(false);
    expect(sinDecode.razon).toBe('ted_no_decodificado');

    const conDecode = puedeCerrarConDocumentos({
      flags,
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [docPendiente, docDecodificado],
    });
    expect(conDecode.puedeCerrar).toBe(true);
  });

  it('un ingreso_manual cuenta como documento subido válido', () => {
    const r = puedeCerrarConDocumentos({
      flags: flagsBase,
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [{ extractionStatus: 'ingreso_manual' }],
    });
    expect(r.puedeCerrar).toBe(true);
  });

  it('si requireDocumentSince es null y el flag ON, aplica a todas las órdenes', () => {
    const r = puedeCerrarConDocumentos({
      flags: { ...flagsBase, requireDocumentSince: null },
      tripCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      documentos: [],
    });
    expect(r.puedeCerrar).toBe(false);
    expect(r.razon).toBe('documento_requerido');
  });
});
