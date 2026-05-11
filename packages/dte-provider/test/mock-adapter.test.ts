import { beforeEach, describe, expect, it } from 'vitest';
import { DteValidationError, MockDteAdapter } from '../src/index.js';
import type { FacturaInput, GuiaDespachoInput } from '../src/index.js';

/**
 * Tests del MockDteAdapter — comportamiento determinístico in-memory
 * para validar el contrato `DteEmitter` y servir como referencia de
 * cómo deben actuar futuros adapters reales.
 */

const RUT_EMISOR = '76.123.456-7';
const RUT_RECEPTOR = '77.987.654-3';

function buildFactura(overrides: Partial<FacturaInput> = {}): FacturaInput {
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
        descripcion: 'Comisión Booster sobre viaje TRK-001',
        montoNetoClp: 24000,
        exento: false,
      },
    ],
    ...overrides,
  };
}

function buildGuia(overrides: Partial<GuiaDespachoInput> = {}): GuiaDespachoInput {
  return {
    emisor: {
      rut: RUT_EMISOR,
      razonSocial: 'Transportes Test SpA',
      giro: 'Transporte de carga',
      direccion: 'Camino Industrial 123',
      comuna: 'Quilicura',
    },
    receptor: {
      rut: RUT_RECEPTOR,
      razonSocial: 'Generador SpA',
      direccion: 'Algun lugar 1',
      comuna: 'Santiago',
    },
    fechaEmision: '2026-05-10',
    origen: { direccion: 'Camino Industrial 123', comuna: 'Quilicura' },
    destino: { direccion: 'Plaza Sotomayor', comuna: 'Valparaíso' },
    items: [{ descripcion: 'Carga de prueba', montoNetoClp: 200000, exento: false }],
    patenteVehiculo: 'ABCD12',
    ...overrides,
  };
}

let adapter: MockDteAdapter;

beforeEach(() => {
  adapter = new MockDteAdapter({ now: () => new Date('2026-05-10T12:00:00Z') });
});

describe('MockDteAdapter — emitFactura', () => {
  it('emite con folio incremental por emisor + tipo', async () => {
    const r1 = await adapter.emitFactura(buildFactura());
    const r2 = await adapter.emitFactura(buildFactura());
    expect(r1.folio).toBe('1');
    expect(r2.folio).toBe('2');
    expect(r1.tipo).toBe(33);
    expect(r1.rutEmisor).toBe(RUT_EMISOR);
  });

  it('calcula montoTotal aplicando IVA 19% sobre items no-exentos', async () => {
    const r = await adapter.emitFactura(buildFactura());
    // 24000 × 1.19 = 28560.
    expect(r.montoTotalClp).toBe(28560);
  });

  it('items exentos no llevan IVA', async () => {
    const r = await adapter.emitFactura(
      buildFactura({
        items: [{ descripcion: 'Operación financiera exenta', montoNetoClp: 50000, exento: true }],
      }),
    );
    // Si todos los items son exentos, monto total = suma neta.
    expect(r.montoTotalClp).toBe(50000);
  });

  it('input inválido (RUT mal formado) → DteValidationError', async () => {
    await expect(
      adapter.emitFactura(
        buildFactura({
          emisor: {
            rut: 'no-es-rut',
            razonSocial: 'X',
            giro: 'Y',
            direccion: 'Z',
            comuna: 'W',
          },
        }),
      ),
    ).rejects.toThrow(DteValidationError);
  });

  it('emitidoEn refleja la fuente de tiempo inyectada', async () => {
    const r = await adapter.emitFactura(buildFactura());
    expect(r.emitidoEn).toBe('2026-05-10T12:00:00.000Z');
  });
});

describe('MockDteAdapter — emitGuiaDespacho', () => {
  it('emite con tipo 52 y URL del PDF mock', async () => {
    const r = await adapter.emitGuiaDespacho(buildGuia());
    expect(r.tipo).toBe(52);
    expect(r.pdfUrl).toContain('/52/');
  });

  it('folios globales por emisor (cross-tipo) para queryStatus sin ambigüedad', async () => {
    const f = await adapter.emitFactura(buildFactura());
    const g1 = await adapter.emitGuiaDespacho(buildGuia());
    const g2 = await adapter.emitGuiaDespacho(buildGuia());
    // El mock asigna folios secuenciales sin separar por tipo — distintos
    // a SII real, pero suficientes para tests del contrato y para que
    // queryStatus(folio, rut) sea determinístico (sin necesidad de tipo).
    expect(f.folio).toBe('1');
    expect(g1.folio).toBe('2');
    expect(g2.folio).toBe('3');
  });

  it('input inválido (patenteVehiculo vacío) → DteValidationError', async () => {
    await expect(adapter.emitGuiaDespacho(buildGuia({ patenteVehiculo: '' }))).rejects.toThrow(
      DteValidationError,
    );
  });
});

describe('MockDteAdapter — queryStatus', () => {
  it('post-emit retorna status en_proceso', async () => {
    const r = await adapter.emitFactura(buildFactura());
    const status = await adapter.queryStatus(r.folio, RUT_EMISOR);
    expect(status.status).toBe('en_proceso');
    expect(status.folio).toBe(r.folio);
  });

  it('folio inexistente → rechazado con mensaje', async () => {
    const status = await adapter.queryStatus('999', RUT_EMISOR);
    expect(status.status).toBe('rechazado');
    expect(status.mensaje).toContain('no encontrado');
  });

  it('setStatus permite simular respuesta de SII en tests', async () => {
    const r = await adapter.emitFactura(buildFactura());
    adapter.setStatus(r.folio, RUT_EMISOR, 'aceptado');
    const status = await adapter.queryStatus(r.folio, RUT_EMISOR);
    expect(status.status).toBe('aceptado');
  });
});

describe('MockDteAdapter — voidDocument', () => {
  it('marca anulado + asigna folioAnulacion + queryStatus refleja anulado', async () => {
    const r = await adapter.emitFactura(buildFactura());
    await adapter.voidDocument(r.folio, RUT_EMISOR, 'Test');
    const status = await adapter.queryStatus(r.folio, RUT_EMISOR);
    expect(status.status).toBe('anulado');
    expect(status.folioAnulacion).toBeTruthy();
  });

  it('idempotente: void sobre folio ya anulado no falla', async () => {
    const r = await adapter.emitFactura(buildFactura());
    await adapter.voidDocument(r.folio, RUT_EMISOR, 'Test 1');
    // Re-call no debe lanzar.
    await expect(adapter.voidDocument(r.folio, RUT_EMISOR, 'Test 2')).resolves.toBeUndefined();
  });

  it('folio inexistente → DteValidationError', async () => {
    await expect(adapter.voidDocument('999', RUT_EMISOR, 'razón')).rejects.toThrow(
      DteValidationError,
    );
  });
});

describe('MockDteAdapter — listEmitted (test introspection)', () => {
  it('lista todos los DTEs emitidos en orden', async () => {
    await adapter.emitFactura(buildFactura());
    await adapter.emitGuiaDespacho(buildGuia());
    const emitted = adapter.listEmitted();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.tipo).toBe(33);
    expect(emitted[1]?.tipo).toBe(52);
  });
});
