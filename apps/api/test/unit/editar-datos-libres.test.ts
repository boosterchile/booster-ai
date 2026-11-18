import { getTableName } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const { editarDatosLibres } = await import('../../src/services/editar-datos-libres.js');

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

const TRIP_ID = 'd3b8c1d2-0000-4000-8000-000000000100';
const EMPRESA = 'd3b8c1d2-0000-4000-8000-000000000300';
const USER = 'd3b8c1d2-0000-4000-8000-000000000600';

interface Viaje {
  status: string;
  consigneeName: string | null;
  consigneeWhatsappE164: string | null;
  consigneeEmail: string | null;
  notes: string | null;
  reference: string | null;
}

const TOKEN = '550e8400-e29b-41d4-a716-446655440000';
const ASIGNACION = { id: 'asg-1', status: 'asignado', empresaId: 'emp-t', driverUserId: 'u-c' };

const viaje = (over: Partial<Viaje> = {}): Viaje => ({
  status: 'asignado',
  consigneeName: 'Bodega',
  consigneeWhatsappE164: '+56911111111',
  consigneeEmail: null,
  notes: null,
  reference: null,
  ...over,
});

/**
 * Stub de la tx: SELECT del viaje (FOR UPDATE), SELECT de la asignación
 * vigente, UPDATE del viaje e INSERT del evento.
 */
function makeDb(opts: { viaje: Viaje | null; asignacion?: Record<string, unknown> | null }) {
  const updates: Array<Record<string, unknown>> = [];
  const tokens: Array<Record<string, unknown>> = [];
  const eventos: Array<Record<string, unknown>> = [];
  const forSpy = vi.fn();
  const select = vi.fn(() => {
    let tabla = '';
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn((t: unknown) => {
      tabla = getTableName(t as never);
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.for = vi.fn((m: string) => {
      forSpy(m);
      return chain;
    });
    chain.limit = vi.fn(async () => {
      if (tabla === 'viajes') {
        return opts.viaje ? [opts.viaje] : [];
      }
      if (tabla === 'asignaciones') {
        return opts.asignacion ? [opts.asignacion] : [];
      }
      return [];
    });
    return chain;
  });
  const update = vi.fn((t: unknown) => ({
    set: vi.fn((v: Record<string, unknown>) => {
      (getTableName(t as never) === 'asignaciones' ? tokens : updates).push(v);
      return { where: vi.fn(async () => undefined) };
    }),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(async (v: Record<string, unknown>) => {
      eventos.push(v);
    }),
  }));
  const tx = { select, update, insert };
  const db = { transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  return { db: db as never, updates, tokens, eventos, forSpy };
}

const llamar = (db: never, input: Record<string, unknown>) =>
  editarDatosLibres({ db, logger }, { tripId: TRIP_ID, empresaId: EMPRESA, userId: USER, input });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('editarDatosLibres', () => {
  it('actualiza notas y referencia con lock del viaje y registra el evento sin valores', async () => {
    const { db, updates, eventos, forSpy } = makeDb({ viaje: viaje() });
    const r = await llamar(db, { notes: 'Andén 4', reference: 'PO-1' });
    expect(r).toMatchObject({ ok: true, campos: ['notes', 'reference'] });
    expect(forSpy).toHaveBeenCalledWith('update');
    expect(updates[0]).toMatchObject({ notes: 'Andén 4', reference: 'PO-1' });
    expect(eventos[0]).toMatchObject({
      tripId: TRIP_ID,
      eventType: 'carga_editada',
      source: 'web',
      recordedByUserId: USER,
      payload: { modo: 'libre', campos: ['notes', 'reference'] },
    });
    expect(JSON.stringify(eventos[0])).not.toContain('Andén 4');
  });

  it('el destinatario se reemplaza completo; null lo borra', async () => {
    const reemplazo = makeDb({ viaje: viaje() });
    await llamar(reemplazo.db, { consignee: { name: 'Recepción' } });
    expect(reemplazo.updates[0]).toMatchObject({
      consigneeName: 'Recepción',
      consigneeWhatsappE164: null,
      consigneeEmail: null,
    });
    const borrado = makeDb({ viaje: viaje() });
    await llamar(borrado.db, { consignee: null });
    expect(borrado.updates[0]).toMatchObject({
      consigneeName: null,
      consigneeWhatsappE164: null,
      consigneeEmail: null,
    });
  });

  it('sin enlace que reemplazar, informa solo el contacto que cambió a un valor', async () => {
    const cambio = makeDb({
      viaje: viaje({ consigneeWhatsappE164: null }),
      asignacion: { ...ASIGNACION, publicTrackingToken: TOKEN },
    });
    const r1 = await llamar(cambio.db, {
      consignee: { name: 'Bodega', phone_e164: '+56922222222', email: 'recepcion@cliente.cl' },
    });
    expect(r1).toMatchObject({
      ok: true,
      enlaceRenovado: false,
      reenviarEnlace: { telefono: '+56922222222', correo: 'recepcion@cliente.cl' },
      asignacion: ASIGNACION,
    });
    expect(cambio.tokens).toHaveLength(0);

    const igual = makeDb({
      viaje: viaje(),
      asignacion: { ...ASIGNACION, publicTrackingToken: TOKEN },
    });
    const r2 = await llamar(igual.db, {
      consignee: { name: 'Otro', phone_e164: '+56911111111' },
    });
    expect(r2).toMatchObject({
      ok: true,
      enlaceRenovado: false,
      reenviarEnlace: { telefono: null, correo: null },
    });
    expect(igual.tokens).toHaveLength(0);
  });

  it('sin cambios reales → sin_cambios, sin escribir', async () => {
    const { db, updates, eventos } = makeDb({ viaje: viaje({ notes: 'Andén 4' }) });
    const r = await llamar(db, { notes: 'Andén 4' });
    expect(r).toEqual({ ok: false, code: 'sin_cambios' });
    expect(updates).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });

  it.each(['entregado', 'cancelado', 'expirado'])(
    '%s → trip_not_editable con el estado',
    async (status) => {
      const { db, updates } = makeDb({ viaje: viaje({ status }) });
      const r = await llamar(db, { notes: 'x' });
      expect(r).toEqual({ ok: false, code: 'trip_not_editable', currentStatus: status });
      expect(updates).toHaveLength(0);
    },
  );

  it('en proceso todavía se editan los datos libres', async () => {
    const { db } = makeDb({ viaje: viaje({ status: 'en_proceso' }) });
    expect(await llamar(db, { notes: 'x' })).toMatchObject({ ok: true });
  });

  it('viaje inexistente o de otra empresa → trip_not_found', async () => {
    const { db } = makeDb({ viaje: null });
    expect(await llamar(db, { notes: 'x' })).toEqual({ ok: false, code: 'trip_not_found' });
  });
});

/**
 * `.specs/seguimiento-enlace-destinatario/` §3.1: el enlace público cambia
 * cuando el contacto que tenía el destinatario cambia o se quita.
 */
describe('editarDatosLibres — enlace de seguimiento', () => {
  const conToken = (v: Partial<Viaje> = {}) =>
    makeDb({ viaje: viaje(v), asignacion: { ...ASIGNACION, publicTrackingToken: TOKEN } });

  it('cambia el teléfono → token nuevo y reenvío a los contactos vigentes', async () => {
    const { db, tokens } = conToken({ consigneeEmail: 'recepcion@cliente.cl' });
    const r = await llamar(db, {
      consignee: { name: 'Bodega', phone_e164: '+56922222222', email: 'recepcion@cliente.cl' },
    });
    expect(r).toMatchObject({
      ok: true,
      enlaceRenovado: true,
      reenviarEnlace: { telefono: '+56922222222', correo: 'recepcion@cliente.cl' },
      asignacion: ASIGNACION,
    });
    expect(tokens).toHaveLength(1);
    const nuevo = tokens[0]?.publicTrackingToken;
    expect(nuevo).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nuevo).not.toBe(TOKEN);
    // El token no sale del servicio: el reenvío lo lee de la asignación.
    expect(JSON.stringify(r)).not.toContain(String(nuevo));
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it('cambia el correo → token nuevo', async () => {
    const { db, tokens } = conToken({
      consigneeWhatsappE164: null,
      consigneeEmail: 'antes@cliente.cl',
    });
    const r = await llamar(db, { consignee: { name: 'Bodega', email: 'ahora@cliente.cl' } });
    expect(r).toMatchObject({
      enlaceRenovado: true,
      reenviarEnlace: { telefono: null, correo: 'ahora@cliente.cl' },
    });
    expect(tokens).toHaveLength(1);
  });

  it('quitar el destinatario → token nuevo y nadie a quien reenviar', async () => {
    const { db, tokens } = conToken();
    const r = await llamar(db, { consignee: null });
    expect(r).toMatchObject({
      enlaceRenovado: true,
      reenviarEnlace: { telefono: null, correo: null },
    });
    expect(tokens).toHaveLength(1);
  });

  it('quitar uno de dos contactos → token nuevo; se reenvía al que queda', async () => {
    const { db, tokens } = conToken({ consigneeEmail: 'recepcion@cliente.cl' });
    const r = await llamar(db, { consignee: { name: 'Bodega', phone_e164: '+56911111111' } });
    expect(r).toMatchObject({
      enlaceRenovado: true,
      reenviarEnlace: { telefono: '+56911111111', correo: null },
    });
    expect(tokens).toHaveLength(1);
  });

  it.each([
    ['solo cambia el nombre', viaje(), { consignee: { name: 'Otro', phone_e164: '+56911111111' } }],
    [
      'se agrega el segundo contacto',
      viaje(),
      { consignee: { name: 'Bodega', phone_e164: '+56911111111', email: 'nuevo@cliente.cl' } },
    ],
    [
      'no había contacto',
      viaje({ consigneeWhatsappE164: null }),
      { consignee: { name: 'Bodega', phone_e164: '+56922222222' } },
    ],
    [
      'el correo solo cambia de mayúsculas',
      viaje({ consigneeEmail: 'recepcion@cliente.cl' }),
      {
        consignee: { name: 'Bodega', phone_e164: '+56911111111', email: 'Recepcion@Cliente.CL' },
      },
    ],
    ['solo cambian las notas', viaje(), { notes: 'Andén 4' }],
  ])('%s → el enlace queda igual', async (_caso, v, input) => {
    const { db, tokens } = makeDb({
      viaje: v,
      asignacion: { ...ASIGNACION, publicTrackingToken: TOKEN },
    });
    expect(await llamar(db, input)).toMatchObject({ ok: true, enlaceRenovado: false });
    expect(tokens).toHaveLength(0);
  });

  it('sin asignación, o con asignación sin token, no hay enlace que cambiar', async () => {
    const sinAsignacion = makeDb({ viaje: viaje() });
    expect(
      await llamar(sinAsignacion.db, { consignee: { name: 'Bodega', phone_e164: '+56922222222' } }),
    ).toMatchObject({ ok: true, enlaceRenovado: false, asignacion: null });
    expect(sinAsignacion.tokens).toHaveLength(0);

    const sinToken = makeDb({
      viaje: viaje(),
      asignacion: { ...ASIGNACION, publicTrackingToken: null },
    });
    expect(
      await llamar(sinToken.db, { consignee: { name: 'Bodega', phone_e164: '+56922222222' } }),
    ).toMatchObject({
      ok: true,
      enlaceRenovado: false,
      reenviarEnlace: { telefono: '+56922222222', correo: null },
    });
    expect(sinToken.tokens).toHaveLength(0);
  });
});
