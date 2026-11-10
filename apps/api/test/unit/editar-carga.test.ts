import { getTableName } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const { editarCargaPreMatch } = await import('../../src/services/editar-carga.js');

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

const futuro = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const START = futuro(24);
const END = futuro(27);

const VIAJE = {
  id: 'trip-1',
  status: 'ofertas_enviadas',
  originAddressRaw: 'A origen 123',
  originRegionCode: 'XIII',
  originComunaCode: null,
  originLatitude: '-33.4100000',
  originLongitude: '-70.5800000',
  destinationAddressRaw: 'B destino 456',
  destinationRegionCode: 'V',
  destinationComunaCode: null,
  destinationLatitude: null,
  destinationLongitude: null,
  cargoType: 'carga_seca',
  cargoWeightKg: 1000,
  cargoVolumeM3: null,
  cargoDescription: null,
  pickupWindowStart: new Date(START),
  pickupWindowEnd: new Date(END),
  proposedPriceClp: null,
  modalidadCarga: 'spot',
  comisionPctAplicada: null,
  consigneeName: null,
  consigneeEmail: null,
  consigneeWhatsappE164: null,
  notes: null,
  reference: null,
};

const FORM = {
  origin: { address_raw: 'A origen 123', region_code: 'XIII' as const },
  destination: { address_raw: 'B destino 456', region_code: 'V' as const },
  cargo: { cargo_type: 'carga_seca' as const, weight_kg: 1000 },
  pickup_window: { start_at: START, end_at: END },
  proposed_price_clp: null,
  modalidad_carga: 'spot' as const,
};

function makeDb(viaje: Record<string, unknown> | null, updates: Array<unknown[]> = []) {
  const sets: Array<{ tabla: string; valores: Record<string, unknown> }> = [];
  const eventos: Array<Record<string, unknown>> = [];
  const cola = [...updates];
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.for = vi.fn(() => chain);
  chain.limit = vi.fn(async () => (viaje ? [viaje] : []));
  const tx = {
    select: vi.fn(() => chain),
    update: vi.fn((t: unknown) => {
      const tabla = getTableName(t as never);
      return {
        set: vi.fn((valores: Record<string, unknown>) => {
          sets.push({ tabla, valores });
          const r = { returning: vi.fn(async () => cola.shift() ?? []) };
          return { where: vi.fn(() => Object.assign(Promise.resolve(), r)) };
        }),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        eventos.push(v);
      }),
    })),
  };
  return {
    db: { transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) } as never,
    sets,
    eventos,
  };
}

const editar = (db: never, input: object, contrato: Date | null = null) =>
  editarCargaPreMatch(
    { db, logger },
    {
      tripId: 'trip-1',
      empresaId: 'emp-1',
      userId: 'user-1',
      input: input as never,
      contratoProgramadoActivadoEn: contrato,
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('editarCargaPreMatch (editar-anular-cargas §6.1)', () => {
  it('cambio material en ofertas_enviadas: expira ofertas y vuelve a esperando_match', async () => {
    const { db, sets, eventos } = makeDb(VIAJE, [[{ id: 'o1' }, { id: 'o2' }], [{ id: 'trip-1' }]]);
    const r = await editar(db, { ...FORM, cargo: { cargo_type: 'carga_seca', weight_kg: 2500 } });
    expect(r).toEqual({
      ok: true,
      cambio: true,
      estado: 'esperando_match',
      ofertasInvalidadas: 2,
      geocodificarOrigen: null,
    });
    expect(sets.map((x) => x.tabla)).toEqual(['viajes', 'ofertas', 'viajes']);
    expect(sets[0]?.valores).toMatchObject({ cargoWeightKg: 2500, originLatitude: '-33.4100000' });
    expect(eventos[0]?.payload).toMatchObject({
      modo: 'pre_match',
      campos: ['weight_kg'],
      antes: { weight_kg: 1000 },
      despues: { weight_kg: 2500 },
      invalidated_offers: 2,
    });
  });

  it('solo datos libres: no toca las ofertas', async () => {
    const { db, sets, eventos } = makeDb(VIAJE);
    const r = await editar(db, { ...FORM, notes: 'Andén 4' });
    expect(r).toMatchObject({
      ok: true,
      cambio: true,
      estado: 'ofertas_enviadas',
      ofertasInvalidadas: 0,
    });
    expect(sets.map((x) => x.tabla)).toEqual(['viajes']);
    expect(eventos[0]?.payload).toMatchObject({ campos: ['notes'], antes: {}, despues: {} });
  });

  it('sin cambios no escribe nada', async () => {
    const { db, sets, eventos } = makeDb(VIAJE);
    expect(await editar(db, FORM)).toMatchObject({ ok: true, cambio: false });
    expect(sets).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });

  it('un origen nuevo sin coordenadas las borra y pide geocodificar', async () => {
    const { db, sets } = makeDb({ ...VIAJE, status: 'esperando_match' });
    const r = await editar(db, { ...FORM, origin: { address_raw: 'Otro 9', region_code: 'XIII' } });
    expect(r).toMatchObject({
      ok: true,
      geocodificarOrigen: { originAddress: 'Otro 9', destinationAddress: 'B destino 456' },
    });
    expect(sets[0]?.valores).toMatchObject({ originLatitude: null, originLongitude: null });
  });

  it.each([
    [null, { ok: false, code: 'trip_not_found' }],
    [
      { ...VIAJE, status: 'emparejando' },
      { ok: false, code: 'trip_busy' },
    ],
    [
      { ...VIAJE, status: 'asignado' },
      { ok: false, code: 'trip_not_editable', currentStatus: 'asignado' },
    ],
  ])('%j → %j', async (viaje, esperado) => {
    const { db } = makeDb(viaje);
    expect(await editar(db, FORM)).toEqual(esperado);
  });

  it('programada sin contrato → contrato_programado_no_habilitado; con contrato pasa', async () => {
    const { db } = makeDb(VIAJE);
    expect(await editar(db, { ...FORM, modalidad_carga: 'programada' })).toEqual({
      ok: false,
      code: 'contrato_programado_no_habilitado',
    });
    const otro = makeDb(VIAJE, [[], [{ id: 'trip-1' }]]);
    expect(
      await editar(otro.db, { ...FORM, modalidad_carga: 'programada' }, new Date()),
    ).toMatchObject({ ok: true, cambio: true });
  });
});
