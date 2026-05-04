import { beforeEach, describe, expect, it } from 'vitest';
import { MockAdapter } from './mock-adapter.js';
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
    email: 'compras@dnorte.cl',
  },
  items: [
    {
      nombre: 'Materiales eléctricos',
      cantidad: 50,
      unidad: 'cajas',
      precioUnitarioClp: 12000,
      exento: false,
    },
  ],
  origen: { direccion: 'Av. Industrias 1', comuna: 'Quilicura' },
  destino: { direccion: 'Av. Norte 100', comuna: 'Antofagasta' },
  patenteVehiculo: 'AB1234',
  rutConductor: '11111111-1',
  indicadorTraslado: 5,
};

const VALID_FACTURA: FacturaInput = {
  rutEmisor: '76543210-3',
  tipo: 'factura_33',
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
      nombre: 'Servicio de transporte',
      cantidad: 1,
      unidad: 'flete',
      precioUnitarioClp: 850000,
      exento: false,
    },
  ],
};

describe('MockAdapter.emitGuiaDespacho', () => {
  let adapter: MockAdapter;
  beforeEach(() => {
    adapter = new MockAdapter({ now: () => new Date('2026-05-04T10:00:00Z') });
  });

  it('emite folio incremental empezando en 1000', async () => {
    const r1 = await adapter.emitGuiaDespacho(VALID_GUIA);
    const r2 = await adapter.emitGuiaDespacho(VALID_GUIA);
    expect(r1.folio).toBe('1000');
    expect(r2.folio).toBe('1001');
  });

  it('retorna providerRef y type=guia_despacho_52', async () => {
    const r = await adapter.emitGuiaDespacho(VALID_GUIA);
    expect(r.providerRef).toBe('mock-1000');
    expect(r.type).toBe('guia_despacho_52');
    expect(r.rutEmisor).toBe('76543210-3');
  });

  it('default status = aceptado', async () => {
    const r = await adapter.emitGuiaDespacho(VALID_GUIA);
    expect(r.status).toBe('aceptado');
  });

  it('respeta defaultStatus configurado', async () => {
    const a = new MockAdapter({ defaultStatus: 'pendiente' });
    const r = await a.emitGuiaDespacho(VALID_GUIA);
    expect(r.status).toBe('pendiente');
  });

  it('idempotencia: misma key → mismo folio', async () => {
    const r1 = await adapter.emitGuiaDespacho({
      ...VALID_GUIA,
      idempotencyKey: 'gd-trip-1',
    });
    const r2 = await adapter.emitGuiaDespacho({
      ...VALID_GUIA,
      idempotencyKey: 'gd-trip-1',
    });
    expect(r1.folio).toBe(r2.folio);
    expect(r1.providerRef).toBe(r2.providerRef);
  });

  it('rechaza input con RUT inválido', async () => {
    await expect(
      adapter.emitGuiaDespacho({
        ...VALID_GUIA,
        rutEmisor: '12345678-X' as GuiaDespachoInput['rutEmisor'],
      }),
    ).rejects.toThrow(/RUT/i);
  });

  it('rechaza input sin items', async () => {
    await expect(adapter.emitGuiaDespacho({ ...VALID_GUIA, items: [] })).rejects.toThrow();
  });

  it('failNext(validation) → DteValidationError', async () => {
    adapter.failNext('validation', 'Folio agotado');
    await expect(adapter.emitGuiaDespacho(VALID_GUIA)).rejects.toBeInstanceOf(DteValidationError);
  });

  it('failNext(provider) → DteProviderError', async () => {
    adapter.failNext('provider', 'SII timeout');
    await expect(adapter.emitGuiaDespacho(VALID_GUIA)).rejects.toBeInstanceOf(DteProviderError);
  });
});

describe('MockAdapter.emitFactura', () => {
  let adapter: MockAdapter;
  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it('emite folio para factura 33', async () => {
    const r = await adapter.emitFactura(VALID_FACTURA);
    expect(r.type).toBe('factura_33');
    expect(r.folio).toBe('1000');
  });

  it('emite folio para factura 34 exenta', async () => {
    const r = await adapter.emitFactura({ ...VALID_FACTURA, tipo: 'factura_34' });
    expect(r.type).toBe('factura_34');
  });
});

describe('MockAdapter.queryStatus', () => {
  let adapter: MockAdapter;
  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it('retorna estado del DTE emitido', async () => {
    const emitted = await adapter.emitGuiaDespacho(VALID_GUIA);
    const status = await adapter.queryStatus(emitted.folio, emitted.rutEmisor);
    expect(status.folio).toBe(emitted.folio);
    expect(status.status).toBe('aceptado');
  });

  it('refleja setStatus subsiguiente', async () => {
    const emitted = await adapter.emitGuiaDespacho(VALID_GUIA);
    adapter.setStatus(emitted.folio, emitted.rutEmisor, 'rechazado', 'RUT receptor inactivo');
    const status = await adapter.queryStatus(emitted.folio, emitted.rutEmisor);
    expect(status.status).toBe('rechazado');
    expect(status.siiMessage).toBe('RUT receptor inactivo');
  });

  it('throw para folio inexistente', async () => {
    await expect(adapter.queryStatus('99999', '76543210-3')).rejects.toThrow(/no encontrado/);
  });
});
