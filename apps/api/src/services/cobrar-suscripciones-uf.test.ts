import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import { cobrarSuscripcionesUf } from './cobrar-suscripciones-uf.js';
import type { VersionConfiguracionComercial } from './configuracion-comercial.js';
import type { MembershipPaymentGateway } from './membership-payment-gateway.js';
import { ValorUfNoDisponibleError } from './valor-uf.js';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const UF = 39_485.65;
const HOY = Date.UTC(2026, 9, 1, 15);
const CONFIG: VersionConfiguracionComercial = {
  id: '00000000-0000-4000-8000-000000000001',
  version: 3,
  config: CONFIGURACION_COMERCIAL_INICIAL,
  vigenteDesde: new Date(HOY),
  notaCambio: 'inicial',
  creadoPorEmail: 'admin@test.invalid',
  creadoEn: new Date(HOY),
};
const EMP = '00000000-0000-4000-8000-0000000000e1';

/**
 * Db falsa: la primera consulta es el listado de empresas (con
 * leftJoin/groupBy) y las siguientes, la factura del periodo por empresa.
 */
function makeDb(opts: {
  empresas: unknown[];
  facturasPorEmpresa?: unknown[][];
  insertImpl?: () => Promise<unknown[]>;
}) {
  const facturas = [...(opts.facturasPorEmpresa ?? [])];
  const insertValues: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  let primera = true;
  const db = {
    select: vi.fn(() => {
      const esListado = primera;
      primera = false;
      const chain: Record<string, unknown> = {
        from: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        groupBy: () => chain,
        limit: async () => (esListado ? opts.empresas : (facturas.shift() ?? [])),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        insertValues.push(v);
        return {
          returning: async () => (opts.insertImpl ? opts.insertImpl() : [{ id: 'fac-1' }]),
        };
      },
    })),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    })),
  };
  return { db: db as never, raw: db, insertValues, updates };
}

function gateway(): MembershipPaymentGateway & { cobrar: ReturnType<typeof vi.fn> } {
  return {
    cobrar: vi.fn(async () => ({ resultado: 'pending_provider' as const, gatewayRef: null })),
  };
}

const empresa = (o: Record<string, unknown> = {}) => ({
  empresaId: EMP,
  esGeneradorCarga: false,
  esTransportista: false,
  gestionFlotaActivadaEn: null,
  camionesActivos: 0,
  ...o,
});

function correr(db: never, gw = gateway(), extra: Record<string, unknown> = {}) {
  return cobrarSuscripcionesUf({
    db,
    logger,
    gateway: gw,
    obtenerUf: async (fecha) => ({ fecha, valorClp: UF, fuente: 'cmf', desdeCache: false }),
    leerConfiguracion: async () => CONFIG,
    hoyMs: HOY,
    ...extra,
  });
}

describe('cobrarSuscripcionesUf', () => {
  it('generador sin factura → INSERT con UF capturada, neto + IVA, y 1er intento', async () => {
    const { db, insertValues, updates } = makeDb({
      empresas: [empresa({ esGeneradorCarga: true })],
    });
    const gw = gateway();
    const r = await correr(db, gw);
    expect(r).toMatchObject({
      status: 'ok',
      periodoMes: '2026-10',
      fechaUf: '2026-10-01',
      ufValorClp: UF,
      ufFuente: 'cmf',
      configuracionVersion: 3,
      evaluadas: 1,
      facturasCreadas: 1,
      pendingProvider: 1,
      exentas: 0,
    });
    expect(insertValues[0]).toMatchObject({
      empresaDestinoId: EMP,
      tipo: 'membership_mensual',
      periodoMes: '2026-10',
      montoUf: '1.0000',
      ufValorClp: '39485.65',
      subtotalClp: 39_486,
      ivaClp: 7_502,
      totalClp: 46_988,
    });
    expect(gw.cobrar).toHaveBeenCalledWith(
      expect.objectContaining({ facturaId: 'fac-1', totalClp: 46_988, intento: 1 }),
    );
    expect(updates[0]).toMatchObject({ cobroEstado: 'pending_payment_provider' });
  });

  it('transportista con gestión de flota usa la tarifa de flota', async () => {
    const { db, insertValues } = makeDb({
      empresas: [
        empresa({ esTransportista: true, camionesActivos: 3, gestionFlotaActivadaEn: new Date() }),
      ],
    });
    await correr(db);
    // (3 − 1) × 1,5 UF.
    expect(insertValues[0]).toMatchObject({ montoUf: '3.0000' });
  });

  it('camiones como string (count de pg) se convierten a número', async () => {
    const { db, insertValues } = makeDb({
      empresas: [empresa({ esTransportista: true, camionesActivos: '4' })],
    });
    await correr(db);
    expect(insertValues[0]).toMatchObject({ montoUf: '3.0000' });
  });

  it('transportista bajo el umbral → exenta, sin INSERT ni cobro', async () => {
    const { db, raw } = makeDb({
      empresas: [empresa({ esTransportista: true, camionesActivos: 1 })],
    });
    const gw = gateway();
    const r = await correr(db, gw);
    expect(r.exentas).toBe(1);
    expect(raw.insert).not.toHaveBeenCalled();
    expect(gw.cobrar).not.toHaveBeenCalled();
  });

  it('factura del periodo ya existe y su reintento venció → reintenta, sin INSERT', async () => {
    const { db, raw } = makeDb({
      empresas: [empresa({ esGeneradorCarga: true })],
      facturasPorEmpresa: [
        [
          {
            id: 'fac-prev',
            totalClp: 46_988,
            cobroEstado: 'pending_payment_provider',
            cobroIntentos: 1,
            cobroProximoIntentoEn: new Date(HOY - 1000),
          },
        ],
      ],
    });
    const gw = gateway();
    const r = await correr(db, gw);
    expect(r.reintentos).toBe(1);
    expect(raw.insert).not.toHaveBeenCalled();
    expect(gw.cobrar).toHaveBeenCalledWith(
      expect.objectContaining({ facturaId: 'fac-prev', intento: 2 }),
    );
  });

  it('UNIQUE envuelta por Drizzle en el INSERT → ya facturada, sin cobro', async () => {
    const dupe = Object.assign(new Error('Failed query: insert'), { cause: { code: '23505' } });
    const { db } = makeDb({
      empresas: [empresa({ esGeneradorCarga: true })],
      insertImpl: async () => {
        throw dupe;
      },
    });
    const gw = gateway();
    const r = await correr(db, gw);
    expect(r.yaFacturadas).toBe(1);
    expect(gw.cobrar).not.toHaveBeenCalled();
  });

  it('otro error en el INSERT se propaga', async () => {
    const { db } = makeDb({
      empresas: [empresa({ esGeneradorCarga: true })],
      insertImpl: async () => {
        throw new Error('connection reset');
      },
    });
    await expect(correr(db)).rejects.toThrow('connection reset');
  });

  it('INSERT sin id devuelto → error de estado inconsistente', async () => {
    const { db } = makeDb({
      empresas: [empresa({ esGeneradorCarga: true })],
      insertImpl: async () => [],
    });
    await expect(correr(db)).rejects.toThrow(/no devolvió id/);
  });

  it('sin valor UF → lanza antes de tocar empresas', async () => {
    const { db, raw } = makeDb({ empresas: [empresa({ esGeneradorCarga: true })] });
    await expect(
      correr(db, gateway(), {
        obtenerUf: async (fecha: string) => {
          throw new ValorUfNoDisponibleError(fecha, ['cmf: caída', 'sii: caída']);
        },
      }),
    ).rejects.toBeInstanceOf(ValorUfNoDisponibleError);
    expect(raw.select).not.toHaveBeenCalled();
  });
});
