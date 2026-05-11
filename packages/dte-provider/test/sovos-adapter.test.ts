import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DteNotConfiguredError,
  DteProviderRejectedError,
  DteTransientError,
  DteValidationError,
  SovosDteAdapter,
} from '../src/index.js';
import type { FacturaInput, GuiaDespachoInput } from '../src/index.js';

/**
 * Tests del SovosDteAdapter (skeleton).
 *
 * Validan:
 *   - Constructor exige apiKey + baseUrl (DteNotConfiguredError sin ellos).
 *   - Mapeo correcto canónico ↔ Sovos para emit/status/void.
 *   - Errores HTTP traducidos a clases canónicas correctas.
 *   - Headers Authorization Bearer presente.
 *
 * Mockean `fetch` directamente (no msw — overhead injustificado para
 * un cliente con 4 endpoints).
 */

const RUT_EMISOR = '76.123.456-7';
const RUT_RECEPTOR = '77.987.654-3';

function buildFactura(): FacturaInput {
  return {
    emisor: {
      rut: RUT_EMISOR,
      razonSocial: 'Booster Chile SpA',
      giro: 'Marketplace logístico',
      direccion: 'Av. Apoquindo 5400',
      comuna: 'Las Condes',
    },
    receptor: {
      rut: RUT_RECEPTOR,
      razonSocial: 'Transportes Test SpA',
    },
    fechaEmision: '2026-05-10',
    items: [
      {
        descripcion: 'Comisión Booster',
        montoNetoClp: 24000,
        exento: false,
      },
    ],
  };
}

function buildGuia(): GuiaDespachoInput {
  return {
    emisor: {
      rut: RUT_EMISOR,
      razonSocial: 'Transportes Test SpA',
      giro: 'Transporte',
      direccion: 'Camino Industrial 123',
      comuna: 'Quilicura',
    },
    receptor: {
      rut: RUT_RECEPTOR,
      razonSocial: 'Generador SpA',
      direccion: 'X',
      comuna: 'Stgo',
    },
    fechaEmision: '2026-05-10',
    origen: { direccion: 'Origen', comuna: 'Quilicura' },
    destino: { direccion: 'Destino', comuna: 'Valparaíso' },
    items: [{ descripcion: 'Carga', montoNetoClp: 200000, exento: false }],
    patenteVehiculo: 'ABCD12',
  };
}

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as Response,
  ) as unknown as typeof fetch;
}

function makeFetchError(status: number, body = 'error body'): typeof fetch {
  return vi.fn(
    async () =>
      ({
        ok: false,
        status,
        json: async () => ({}),
        text: async () => body,
      }) as Response,
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SovosDteAdapter — constructor', () => {
  it('sin apiKey → DteNotConfiguredError', () => {
    expect(() => new SovosDteAdapter({ apiKey: '', baseUrl: 'https://x' })).toThrow(
      DteNotConfiguredError,
    );
  });

  it('sin baseUrl → DteNotConfiguredError', () => {
    expect(() => new SovosDteAdapter({ apiKey: 'k', baseUrl: '' })).toThrow(DteNotConfiguredError);
  });

  it('strip trailing slash del baseUrl', async () => {
    const fetchSpy = makeFetchOk({
      folio: '42',
      tipo_dte: 33,
      rut_emisor: RUT_EMISOR,
      monto_total_clp: 28560,
    });
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://api.sovos.cl/v1/',
      fetchImpl: fetchSpy,
    });
    await adapter.emitFactura(buildFactura());
    const callArgs = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs?.[0]).toBe('https://api.sovos.cl/v1/dte/emit');
  });
});

describe('SovosDteAdapter — emitFactura', () => {
  it('happy path: mapea response Sovos a DteResult canónico', async () => {
    const fetchSpy = makeFetchOk({
      folio: '1234',
      tipo_dte: 33,
      rut_emisor: RUT_EMISOR,
      emitido_en: '2026-05-10T12:00:00Z',
      monto_total_clp: 28560,
      pdf_url: 'https://sovos.example/dte/1234.pdf',
      track_id: 'sovos-track-abc',
    });
    const adapter = new SovosDteAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.sovos.cl/v1',
      fetchImpl: fetchSpy,
    });
    const result = await adapter.emitFactura(buildFactura());
    expect(result).toEqual({
      folio: '1234',
      tipo: 33,
      rutEmisor: RUT_EMISOR,
      emitidoEn: '2026-05-10T12:00:00Z',
      montoTotalClp: 28560,
      pdfUrl: 'https://sovos.example/dte/1234.pdf',
      providerTrackId: 'sovos-track-abc',
    });
  });

  it('headers incluyen Authorization Bearer + Content-Type', async () => {
    const fetchSpy = makeFetchOk({
      folio: '1',
      tipo_dte: 33,
      rut_emisor: RUT_EMISOR,
      monto_total_clp: 100,
    });
    const adapter = new SovosDteAdapter({
      apiKey: 'secret-key',
      baseUrl: 'https://api.sovos.cl',
      fetchImpl: fetchSpy,
    });
    await adapter.emitFactura(buildFactura());
    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('payload mapeado a snake_case Sovos', async () => {
    const fetchSpy = makeFetchOk({
      folio: '1',
      tipo_dte: 33,
      rut_emisor: RUT_EMISOR,
      monto_total_clp: 100,
    });
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://api.sovos.cl',
      fetchImpl: fetchSpy,
    });
    await adapter.emitFactura(buildFactura());
    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.tipo_dte).toBe(33);
    expect(body.fecha_emision).toBe('2026-05-10');
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[0]?.monto_neto_clp).toBe(24000);
  });

  it('input inválido → DteValidationError (no llega al fetch)', async () => {
    const fetchSpy = vi.fn();
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const bad: FacturaInput = {
      ...buildFactura(),
      emisor: { ...buildFactura().emisor, rut: 'invalid' },
    };
    await expect(adapter.emitFactura(bad)).rejects.toThrow(DteValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('5xx → DteTransientError', async () => {
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: makeFetchError(503),
    });
    await expect(adapter.emitFactura(buildFactura())).rejects.toThrow(DteTransientError);
  });

  it('4xx → DteProviderRejectedError con providerCode', async () => {
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: makeFetchError(400, 'cert expirado'),
    });
    await expect(adapter.emitFactura(buildFactura())).rejects.toThrow(DteProviderRejectedError);
  });

  it('fetch throws (network) → DteTransientError', async () => {
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: (() => {
        throw new Error('ENETUNREACH');
      }) as unknown as typeof fetch,
    });
    await expect(adapter.emitFactura(buildFactura())).rejects.toThrow(DteTransientError);
  });
});

describe('SovosDteAdapter — emitGuiaDespacho', () => {
  it('mapea tipo_dte 52 y patenteVehiculo en payload', async () => {
    const fetchSpy = makeFetchOk({
      folio: '5',
      tipo_dte: 52,
      rut_emisor: RUT_EMISOR,
      monto_total_clp: 238000,
    });
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: fetchSpy,
    });
    const r = await adapter.emitGuiaDespacho(buildGuia());
    expect(r.tipo).toBe(52);
    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.patente_vehiculo).toBe('ABCD12');
  });
});

describe('SovosDteAdapter — queryStatus', () => {
  it('mapea estado_sii ACEPTADO → status aceptado', async () => {
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: makeFetchOk({
        folio: '1',
        tipo_dte: 33,
        estado_sii: 'ACEPTADO',
      }),
    });
    const status = await adapter.queryStatus('1', RUT_EMISOR);
    expect(status.status).toBe('aceptado');
  });

  it('mapea RECHAZADO con mensaje_sii', async () => {
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: makeFetchOk({
        folio: '1',
        tipo_dte: 33,
        estado_sii: 'RECHAZADO',
        mensaje_sii: 'Folio fuera de rango',
      }),
    });
    const status = await adapter.queryStatus('1', RUT_EMISOR);
    expect(status.status).toBe('rechazado');
    expect(status.mensaje).toBe('Folio fuera de rango');
  });

  it('estado desconocido → en_proceso (fallback)', async () => {
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: makeFetchOk({
        folio: '1',
        tipo_dte: 33,
        estado_sii: 'XYZ_UNKNOWN_STATE',
      }),
    });
    const status = await adapter.queryStatus('1', RUT_EMISOR);
    expect(status.status).toBe('en_proceso');
  });

  it('ANULADO con folio_anulacion → mapea correctamente', async () => {
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: makeFetchOk({
        folio: '1',
        tipo_dte: 33,
        estado_sii: 'ANULADO',
        folio_anulacion: '99',
      }),
    });
    const status = await adapter.queryStatus('1', RUT_EMISOR);
    expect(status.status).toBe('anulado');
    expect(status.folioAnulacion).toBe('99');
  });
});

describe('SovosDteAdapter — voidDocument', () => {
  it('POST /dte/void con body folio + rut + razon', async () => {
    const fetchSpy = makeFetchOk({ ok: true });
    const adapter = new SovosDteAdapter({
      apiKey: 'k',
      baseUrl: 'https://x',
      fetchImpl: fetchSpy,
    });
    await adapter.voidDocument('1234', RUT_EMISOR, 'duplicado SII');
    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      folio: '1234',
      rut_emisor: RUT_EMISOR,
      razon: 'duplicado SII',
    });
  });
});
