import { describe, expect, it } from 'vitest';
import {
  DteCertificateError,
  DteFolioConflictError,
  DteNotFoundError,
  DteProviderUnavailableError,
  DteRejectedBySiiError,
  DteValidationError,
  type FacturaInput,
  type GuiaDespachoInput,
  MockDteProvider,
} from '../src/index.js';

const validGuia: GuiaDespachoInput = {
  rutEmisor: '76123456-7',
  razonSocialEmisor: 'Transportes Test SpA',
  rutReceptor: '12345678-9',
  razonSocialReceptor: 'Cliente SA',
  fechaEmision: new Date('2026-05-03T10:00:00Z'),
  items: [
    {
      descripcion: 'Transporte Santiago → Concepción',
      cantidad: 1,
      precioUnitarioClp: 850000,
      unidadMedida: 'VIAJE',
    },
  ],
  transporte: {
    rutChofer: '11111111-1',
    nombreChofer: 'Juan Pérez',
    patente: 'AB-CD-12',
    direccionDestino: 'Av. Principal 123',
    comunaDestino: 'Concepción',
  },
  tipoDespacho: 5,
};

const validFactura: FacturaInput = {
  tipoDte: 33,
  rutEmisor: '76123456-7',
  razonSocialEmisor: 'Transportes Test SpA',
  giroEmisor: 'Transporte de Carga',
  rutReceptor: '12345678-9',
  razonSocialReceptor: 'Cliente SA',
  giroReceptor: 'Comercio',
  fechaEmision: new Date('2026-05-03T10:00:00Z'),
  items: [
    {
      descripcion: 'Servicio de transporte',
      cantidad: 1,
      precioUnitarioClp: 850000,
      unidadMedida: 'UN',
    },
  ],
};

describe('MockDteProvider — emitGuiaDespacho happy path', () => {
  it('emite folio 1 inicial + status accepted + sha256 válido', async () => {
    const provider = new MockDteProvider();
    const result = await provider.emitGuiaDespacho(validGuia);

    expect(result.folio).toBe('1');
    expect(result.tipoDte).toBe(52);
    expect(result.rutEmisor).toBe('76123456-7');
    expect(result.status).toBe('accepted');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.xmlSigned).toContain('<DTE mock="true">');
    expect(result.providerTrackId).toBe('mock-track-52-1');
  });

  it('folios autoincrementales por (rutEmisor, tipoDte)', async () => {
    const provider = new MockDteProvider();
    const r1 = await provider.emitGuiaDespacho(validGuia);
    const r2 = await provider.emitGuiaDespacho(validGuia);
    const r3 = await provider.emitGuiaDespacho(validGuia);
    expect([r1.folio, r2.folio, r3.folio]).toEqual(['1', '2', '3']);
  });

  it('folios independientes entre emisores', async () => {
    const provider = new MockDteProvider();
    const r1 = await provider.emitGuiaDespacho(validGuia);
    const r2 = await provider.emitGuiaDespacho({
      ...validGuia,
      rutEmisor: '99999999-9',
      razonSocialEmisor: 'Otro Emisor',
    });
    expect(r1.folio).toBe('1');
    expect(r2.folio).toBe('1'); // primer folio para emisor distinto
  });

  it('startingFolio override respeta el inicio', async () => {
    const provider = new MockDteProvider({ startingFolio: 100 });
    const result = await provider.emitGuiaDespacho(validGuia);
    expect(result.folio).toBe('100');
  });

  it('sha256 determinístico para mismo input + folio', async () => {
    const p1 = new MockDteProvider();
    const p2 = new MockDteProvider();
    const r1 = await p1.emitGuiaDespacho(validGuia);
    const r2 = await p2.emitGuiaDespacho(validGuia);
    expect(r1.sha256).toBe(r2.sha256);
  });
});

describe('MockDteProvider — emitFactura happy path', () => {
  it('factura DTE 33 (afecta IVA)', async () => {
    const provider = new MockDteProvider();
    const result = await provider.emitFactura(validFactura);
    expect(result.tipoDte).toBe(33);
    expect(result.folio).toBe('1');
  });

  it('factura DTE 34 (exenta) usa folio independiente del 33', async () => {
    const provider = new MockDteProvider();
    const r33 = await provider.emitFactura(validFactura);
    const r34 = await provider.emitFactura({ ...validFactura, tipoDte: 34 });
    expect(r33.folio).toBe('1');
    expect(r34.folio).toBe('1'); // distinto pool
  });
});

describe('MockDteProvider — validación Zod', () => {
  it('rechaza RUT mal formado con DteValidationError', async () => {
    const provider = new MockDteProvider();
    await expect(
      provider.emitGuiaDespacho({ ...validGuia, rutEmisor: 'no-es-rut' }),
    ).rejects.toThrowError(DteValidationError);
  });

  it('rechaza items vacíos', async () => {
    const provider = new MockDteProvider();
    await expect(provider.emitGuiaDespacho({ ...validGuia, items: [] })).rejects.toThrowError(
      DteValidationError,
    );
  });

  it('error message incluye field errors', async () => {
    const provider = new MockDteProvider();
    try {
      await provider.emitGuiaDespacho({
        ...validGuia,
        rutEmisor: 'no-es-rut',
        razonSocialEmisor: '',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(DteValidationError);
      const e = err as DteValidationError;
      expect(Object.keys(e.fieldErrors).length).toBeGreaterThanOrEqual(1);
      expect(e.fieldErrors.rutEmisor).toBeDefined();
    }
  });
});

describe('MockDteProvider — failNextEmit (error injection)', () => {
  it('rejected_sii throws DteRejectedBySiiError una sola vez', async () => {
    const provider = new MockDteProvider({ failNextEmit: 'rejected_sii' });
    await expect(provider.emitGuiaDespacho(validGuia)).rejects.toThrowError(DteRejectedBySiiError);
    // Segundo intento debe pasar
    const ok = await provider.emitGuiaDespacho(validGuia);
    expect(ok.folio).toBeDefined();
  });

  it('certificate_error throws DteCertificateError con rutEmisor', async () => {
    const provider = new MockDteProvider({ failNextEmit: 'certificate_error' });
    try {
      await provider.emitGuiaDespacho(validGuia);
    } catch (err) {
      expect(err).toBeInstanceOf(DteCertificateError);
      expect((err as DteCertificateError).rutEmisor).toBe('76123456-7');
    }
  });

  it('unavailable throws DteProviderUnavailableError', async () => {
    const provider = new MockDteProvider({ failNextEmit: 'unavailable' });
    await expect(provider.emitGuiaDespacho(validGuia)).rejects.toThrowError(
      DteProviderUnavailableError,
    );
  });

  it('folio_conflict throws DteFolioConflictError', async () => {
    const provider = new MockDteProvider({ failNextEmit: 'folio_conflict' });
    await expect(provider.emitGuiaDespacho(validGuia)).rejects.toThrowError(DteFolioConflictError);
  });
});

describe('MockDteProvider — queryStatus', () => {
  it('retorna status accepted post-emit', async () => {
    const provider = new MockDteProvider();
    const result = await provider.emitGuiaDespacho(validGuia);
    const status = await provider.queryStatus({
      folio: result.folio,
      rutEmisor: result.rutEmisor,
      tipoDte: 52,
    });
    expect(status.status).toBe('accepted');
    expect(status.folio).toBe(result.folio);
  });

  it('throws DteNotFoundError para folio inexistente', async () => {
    const provider = new MockDteProvider();
    await expect(
      provider.queryStatus({
        folio: '999',
        rutEmisor: '76123456-7',
        tipoDte: 52,
      }),
    ).rejects.toThrowError(DteNotFoundError);
  });

  it('throws DteNotFoundError si el rutEmisor no matchea', async () => {
    const provider = new MockDteProvider();
    const result = await provider.emitGuiaDespacho(validGuia);
    await expect(
      provider.queryStatus({
        folio: result.folio,
        rutEmisor: '99999999-9', // distinto
        tipoDte: 52,
      }),
    ).rejects.toThrowError(DteNotFoundError);
  });

  it('lastCheckedAt se refresca en cada query', async () => {
    const provider = new MockDteProvider();
    const result = await provider.emitGuiaDespacho(validGuia);
    const s1 = await provider.queryStatus({
      folio: result.folio,
      rutEmisor: result.rutEmisor,
      tipoDte: 52,
    });
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await provider.queryStatus({
      folio: result.folio,
      rutEmisor: result.rutEmisor,
      tipoDte: 52,
    });
    expect(s2.lastCheckedAt.getTime()).toBeGreaterThan(s1.lastCheckedAt.getTime());
  });
});

describe('MockDteProvider — environment', () => {
  it('default certification', () => {
    const p = new MockDteProvider();
    expect(p.environment).toBe('certification');
  });

  it('respeta override production', () => {
    const p = new MockDteProvider({ environment: 'production' });
    expect(p.environment).toBe('production');
  });
});

describe('MockDteProvider — artificial latency', () => {
  it('simulación de latencia funciona', async () => {
    const provider = new MockDteProvider({ artificialLatencyMs: 50 });
    const start = Date.now();
    await provider.emitGuiaDespacho(validGuia);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // tolerancia jitter
  });
});
