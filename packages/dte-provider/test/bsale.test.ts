import { describe, expect, it, vi } from 'vitest';
import {
  BsaleAdapter,
  DteCertificateError,
  DteFolioConflictError,
  DteNotFoundError,
  DteProviderError,
  DteProviderUnavailableError,
  DteRejectedBySiiError,
  DteValidationError,
  type FacturaInput,
  type GuiaDespachoInput,
} from '../src/index.js';

const validGuia: GuiaDespachoInput = {
  rutEmisor: '76123456-7',
  razonSocialEmisor: 'Transportes Test SpA',
  rutReceptor: '12345678-9',
  razonSocialReceptor: 'Cliente SA',
  fechaEmision: new Date('2026-05-04T10:00:00Z'),
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
  fechaEmision: new Date('2026-05-04T10:00:00Z'),
  items: [
    {
      descripcion: 'Servicio de transporte',
      cantidad: 1,
      precioUnitarioClp: 850000,
      unidadMedida: 'UN',
    },
  ],
};

function mockFetch(implementation: typeof fetch): typeof fetch {
  return implementation;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('BsaleAdapter — constructor', () => {
  it('throws DteCertificateError si no hay apiToken', () => {
    expect(
      () =>
        new BsaleAdapter({
          apiToken: '',
          environment: 'certification',
        }),
    ).toThrowError(DteCertificateError);
  });

  it('default baseUrl es https://api.bsale.io/v1', () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { id: 1, number: 100 }));
    const adapter = new BsaleAdapter({
      apiToken: 'test-token',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });
    void adapter.emitGuiaDespacho(validGuia);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://api.bsale.io/v1/documents.json'),
      expect.any(Object),
    );
  });

  it('environment se persiste en la propiedad pública', () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'production',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(adapter.environment).toBe('production');
  });
});

describe('BsaleAdapter — emitGuiaDespacho', () => {
  it('emite y mapea response Bsale a DteResult', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 999,
        number: 12345,
        urlXml: '<DTE>signed-xml-content</DTE>',
        informationDte: { status: 'accepted' },
      }),
    );
    const adapter = new BsaleAdapter({
      apiToken: 'test-token',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });

    const result = await adapter.emitGuiaDespacho(validGuia);
    expect(result.folio).toBe('12345');
    expect(result.tipoDte).toBe(52);
    expect(result.status).toBe('accepted');
    expect(result.providerTrackId).toBe('999');
    expect(result.xmlSigned).toBe('<DTE>signed-xml-content</DTE>');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('envía access_token header', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: 1, number: 1, urlXml: 'x' }));
    const adapter = new BsaleAdapter({
      apiToken: 'super-secret',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });
    await adapter.emitGuiaDespacho(validGuia);
    const init = (fetchSpy.mock.calls[0]?.[1] ?? {}) as RequestInit;
    expect(init.headers).toMatchObject({
      access_token: 'super-secret',
    });
  });

  it('xmlSigned vacío → sha256="pending"', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 1,
        number: 1,
        // sin urlXml
        informationDte: { status: 'pending' },
      }),
    );
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });
    const result = await adapter.emitGuiaDespacho(validGuia);
    expect(result.sha256).toBe('pending');
    expect(result.status).toBe('pending_sii_validation');
  });

  it('rechaza input inválido con DteValidationError SIN llamar a fetch', async () => {
    const fetchSpy = vi.fn();
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });
    await expect(
      adapter.emitGuiaDespacho({ ...validGuia, rutEmisor: 'no-es-rut' }),
    ).rejects.toThrowError(DteValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('BsaleAdapter — emitFactura', () => {
  it('emite factura DTE 33 con referenciaGuia', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: 2, number: 200, urlXml: 'x' }));
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });

    const result = await adapter.emitFactura({
      ...validFactura,
      referenciaGuia: {
        folio: '12345',
        fechaEmision: new Date('2026-05-04T09:00:00Z'),
      },
    });
    expect(result.folio).toBe('200');
    expect(result.tipoDte).toBe(33);

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.references).toHaveLength(1);
    expect(body.references[0].folio).toBe('12345');
    expect(body.references[0].documentReferenceId).toBe(52);
  });
});

describe('BsaleAdapter — error mapping HTTP', () => {
  it('400 → DteValidationError', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi.fn().mockResolvedValue(textResponse(400, 'Invalid request')) as unknown as typeof fetch,
      ),
    });
    await expect(adapter.emitGuiaDespacho(validGuia)).rejects.toThrowError(DteValidationError);
  });

  it('401 → DteCertificateError', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi.fn().mockResolvedValue(textResponse(401, 'Unauthorized')) as unknown as typeof fetch,
      ),
    });
    await expect(adapter.emitGuiaDespacho(validGuia)).rejects.toThrowError(DteCertificateError);
  });

  it('409 → DteFolioConflictError', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi.fn().mockResolvedValue(textResponse(409, 'Folio in use')) as unknown as typeof fetch,
      ),
    });
    await expect(adapter.emitGuiaDespacho(validGuia)).rejects.toThrowError(DteFolioConflictError);
  });

  it('422 → DteRejectedBySiiError con metadata', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi
          .fn()
          .mockResolvedValue(
            textResponse(422, 'SII rejected: RUT not registered'),
          ) as unknown as typeof fetch,
      ),
    });
    try {
      await adapter.emitGuiaDespacho(validGuia);
    } catch (err) {
      expect(err).toBeInstanceOf(DteRejectedBySiiError);
      const e = err as DteRejectedBySiiError;
      expect(e.siiErrorCode).toBe('BSALE_422');
      expect(e.siiErrorDetail).toContain('SII rejected');
    }
  });

  it('500 → DteProviderUnavailableError', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi
          .fn()
          .mockResolvedValue(textResponse(503, 'Service Unavailable')) as unknown as typeof fetch,
      ),
    });
    await expect(adapter.emitGuiaDespacho(validGuia)).rejects.toThrowError(
      DteProviderUnavailableError,
    );
  });

  it('200 sin number/folio → DteProviderError', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(200, { id: 1 /* sin number */ }),
          ) as unknown as typeof fetch,
      ),
    });
    await expect(adapter.emitGuiaDespacho(validGuia)).rejects.toThrowError(DteProviderError);
  });
});

describe('BsaleAdapter — queryStatus', () => {
  it('mapea response Bsale a DteStatus', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: 1,
            number: 12345,
            informationDte: { status: 'accepted' },
          },
        ],
      }),
    );
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });

    const status = await adapter.queryStatus({
      folio: '12345',
      rutEmisor: '76123456-7',
      tipoDte: 52,
    });
    expect(status.status).toBe('accepted');
    expect(status.folio).toBe('12345');
    expect(status.tipoDte).toBe(52);
  });

  it('rejected con rejectionReason', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: 1,
            number: 99,
            informationDte: {
              status: 'rejected',
              rejectionReason: 'Glosa inválida',
            },
          },
        ],
      }),
    );
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });

    const status = await adapter.queryStatus({
      folio: '99',
      rutEmisor: '76123456-7',
      tipoDte: 52,
    });
    expect(status.status).toBe('rejected');
    expect(status.rejectionReason).toBe('Glosa inválida');
  });

  it('items vacío → DteNotFoundError', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi.fn().mockResolvedValue(jsonResponse(200, { items: [] })) as unknown as typeof fetch,
      ),
    });
    await expect(
      adapter.queryStatus({
        folio: '999',
        rutEmisor: '76123456-7',
        tipoDte: 52,
      }),
    ).rejects.toThrowError(DteNotFoundError);
  });

  it('404 → DteNotFoundError', async () => {
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(
        vi.fn().mockResolvedValue(textResponse(404, 'Not Found')) as unknown as typeof fetch,
      ),
    });
    await expect(
      adapter.queryStatus({
        folio: '999',
        rutEmisor: '76123456-7',
        tipoDte: 52,
      }),
    ).rejects.toThrowError(DteNotFoundError);
  });
});

describe('BsaleAdapter — timeout handling', () => {
  it('AbortError → DteProviderUnavailableError', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
      timeoutMs: 100,
    });
    await expect(adapter.emitGuiaDespacho(validGuia)).rejects.toThrowError(
      DteProviderUnavailableError,
    );
  });

  it('error de red genérico → DteProviderError', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network error: ECONNREFUSED'));
    const adapter = new BsaleAdapter({
      apiToken: 'x',
      environment: 'certification',
      fetchImpl: mockFetch(fetchSpy as unknown as typeof fetch),
    });
    await expect(adapter.emitGuiaDespacho(validGuia)).rejects.toThrowError(DteProviderError);
  });
});
