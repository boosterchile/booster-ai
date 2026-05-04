import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type HttpClient, PaperlessAdapter } from './paperless-adapter.js';
import { DteProviderError, DteValidationError } from './tipos.js';
import type { FacturaInput, GuiaDespachoInput } from './tipos.js';

const VALID_GUIA: GuiaDespachoInput = {
  rutEmisor: '76543210-3',
  receptor: {
    rut: '11111111-1',
    razonSocial: 'Distribuidora Norte SpA',
    giro: 'Distribución mayorista',
    direccion: 'Av. Norte 100',
    comuna: 'Antofagasta',
    region: 'II',
  },
  items: [
    {
      nombre: 'Materiales',
      cantidad: 50,
      unidad: 'cajas',
      precioUnitarioClp: 12000,
      exento: false,
    },
  ],
  origen: { direccion: 'Av. 1', comuna: 'Quilicura' },
  destino: { direccion: 'Av. 2', comuna: 'Antofagasta' },
  patenteVehiculo: 'AB1234',
  rutConductor: '11111111-1',
  indicadorTraslado: 5,
};

function makeFakeHttp(responses: Array<{ status: number; body: string }>): {
  http: HttpClient;
  calls: Array<Parameters<HttpClient['request']>[0]>;
} {
  const calls: Array<Parameters<HttpClient['request']>[0]> = [];
  let i = 0;
  const http: HttpClient = {
    request: vi.fn(async (opts) => {
      calls.push(opts);
      const r = responses[i++];
      if (!r) {
        throw new Error('Sin response disponible');
      }
      return r;
    }),
  };
  return { http, calls };
}

describe('PaperlessAdapter.emitGuiaDespacho', () => {
  let adapter: PaperlessAdapter;
  let httpStub: ReturnType<typeof makeFakeHttp>;

  beforeEach(() => {
    httpStub = makeFakeHttp([
      {
        status: 200,
        body: JSON.stringify({
          folio: 1234,
          trackId: 'pl-trk-abc',
          emittedAt: '2026-05-04T10:00:00.000Z',
          status: 'pending',
          pdfUrl: 'https://api.paperless.cl/pdf/abc',
          xmlUrl: 'https://api.paperless.cl/xml/abc',
        }),
      },
    ]);
    adapter = new PaperlessAdapter({
      apiKey: 'test-key-123',
      baseUrl: 'https://api.sandbox.paperless.cl/v1',
      httpClient: httpStub.http,
    });
  });

  it('hace POST al endpoint correcto con Bearer auth', async () => {
    await adapter.emitGuiaDespacho(VALID_GUIA);
    const call = httpStub.calls[0];
    expect(call?.url).toBe('https://api.sandbox.paperless.cl/v1/dte/guia-despacho');
    expect(call?.method).toBe('POST');
    expect(call?.headers.Authorization).toBe('Bearer test-key-123');
    expect(call?.headers['Content-Type']).toBe('application/json');
  });

  it('parsea folio + status + pdfUrl + xmlUrl del response', async () => {
    const r = await adapter.emitGuiaDespacho(VALID_GUIA);
    expect(r.folio).toBe('1234');
    expect(r.providerRef).toBe('pl-trk-abc');
    expect(r.status).toBe('pendiente');
    expect(r.pdfUrl).toBe('https://api.paperless.cl/pdf/abc');
    expect(r.xmlUrl).toBe('https://api.paperless.cl/xml/abc');
    expect(r.type).toBe('guia_despacho_52');
  });

  it('mapea indicadorTraslado y transporte al payload', async () => {
    await adapter.emitGuiaDespacho(VALID_GUIA);
    const body = JSON.parse(httpStub.calls[0]?.body ?? '{}');
    expect(body.indicadorTraslado).toBe(5);
    expect(body.transporte.patente).toBe('AB1234');
    expect(body.transporte.origen.comuna).toBe('Quilicura');
    expect(body.transporte.destino.comuna).toBe('Antofagasta');
  });

  it('idempotencyKey va en header Idempotency-Key', async () => {
    await adapter.emitGuiaDespacho({ ...VALID_GUIA, idempotencyKey: 'gd-trip-1' });
    expect(httpStub.calls[0]?.headers['Idempotency-Key']).toBe('gd-trip-1');
  });

  it('omite Idempotency-Key si no se provee', async () => {
    await adapter.emitGuiaDespacho(VALID_GUIA);
    expect(httpStub.calls[0]?.headers['Idempotency-Key']).toBeUndefined();
  });
});

describe('PaperlessAdapter — error handling', () => {
  it('4xx → DteValidationError con siiCode', async () => {
    const stub = makeFakeHttp([
      {
        status: 400,
        body: JSON.stringify({ message: 'RUT receptor no válido', siiCode: 'SII-005' }),
      },
    ]);
    const adapter = new PaperlessAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      httpClient: stub.http,
    });
    try {
      await adapter.emitGuiaDespacho(VALID_GUIA);
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(DteValidationError);
      expect((err as DteValidationError).siiCode).toBe('SII-005');
    }
  });

  it('5xx → DteProviderError con httpStatus', async () => {
    const stub = makeFakeHttp([{ status: 503, body: 'gateway timeout' }]);
    const adapter = new PaperlessAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      httpClient: stub.http,
    });
    try {
      await adapter.emitGuiaDespacho(VALID_GUIA);
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(DteProviderError);
      expect((err as DteProviderError).httpStatus).toBe(503);
    }
  });
});

describe('PaperlessAdapter.queryStatus', () => {
  it('hace GET al path correcto y mapea estado', async () => {
    const stub = makeFakeHttp([
      {
        status: 200,
        body: JSON.stringify({
          folio: '1234',
          status: 'rejected',
          siiMessage: 'Folio agotado',
          updatedAt: '2026-05-04T10:00:00.000Z',
        }),
      },
    ]);
    const adapter = new PaperlessAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      httpClient: stub.http,
    });
    const status = await adapter.queryStatus('1234', '76543210-3');
    expect(status.folio).toBe('1234');
    expect(status.status).toBe('rechazado');
    expect(status.siiMessage).toBe('Folio agotado');
    expect(stub.calls[0]?.method).toBe('GET');
    expect(stub.calls[0]?.url).toContain('/dte/76543210-3/1234/status');
  });
});

describe('PaperlessAdapter — facturas', () => {
  const VALID_FACTURA: FacturaInput = {
    rutEmisor: '76543210-3',
    tipo: 'factura_33',
    receptor: {
      rut: '11111111-1',
      razonSocial: 'Cliente',
      giro: 'Servicios',
      direccion: 'Av. 3',
      comuna: 'Santiago',
      region: 'XIII',
    },
    items: [
      {
        nombre: 'Servicio',
        cantidad: 1,
        unidad: 'unidad',
        precioUnitarioClp: 100000,
        exento: false,
      },
    ],
  };

  it('mapea tipoDte=33 al payload', async () => {
    const stub = makeFakeHttp([
      { status: 200, body: JSON.stringify({ folio: 1, trackId: 't', status: 'accepted' }) },
    ]);
    const adapter = new PaperlessAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      httpClient: stub.http,
    });
    await adapter.emitFactura(VALID_FACTURA);
    const body = JSON.parse(stub.calls[0]?.body ?? '{}');
    expect(body.tipoDte).toBe(33);
  });

  it('mapea tipoDte=34 para factura exenta', async () => {
    const stub = makeFakeHttp([
      { status: 200, body: JSON.stringify({ folio: 1, trackId: 't', status: 'accepted' }) },
    ]);
    const adapter = new PaperlessAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      httpClient: stub.http,
    });
    await adapter.emitFactura({ ...VALID_FACTURA, tipo: 'factura_34' });
    const body = JSON.parse(stub.calls[0]?.body ?? '{}');
    expect(body.tipoDte).toBe(34);
  });

  it('incluye referencia a guía cuando refFolioGuia se provee', async () => {
    const stub = makeFakeHttp([
      { status: 200, body: JSON.stringify({ folio: 1, trackId: 't', status: 'accepted' }) },
    ]);
    const adapter = new PaperlessAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      httpClient: stub.http,
    });
    await adapter.emitFactura({ ...VALID_FACTURA, refFolioGuia: '1000' });
    const body = JSON.parse(stub.calls[0]?.body ?? '{}');
    expect(body.referencias).toEqual([{ tipoDocumento: 52, folio: '1000' }]);
  });
});
