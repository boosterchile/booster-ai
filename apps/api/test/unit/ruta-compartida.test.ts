import { describe, expect, it, vi } from 'vitest';
import { assignments, eventosRuta, paradasRuta, rutas, vehicles } from '../../src/db/schema.js';
import {
  cargarRuta,
  configuracionDe,
  pesoQueNoCabeEnLaRuta,
} from '../../src/services/cargar-ruta.js';
import { sincronizarFila } from '../../src/services/sincronizar-ruta-de-asignacion.js';

// El recorrido contra PostgreSQL está en
// test/integration/ruta-consolidada.integration.test.ts; aquí, las ramas.

type Filas = Record<string, unknown>[];

function consulta(filas: Filas) {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    { where: () => cadena, orderBy: () => cadena, for: () => cadena, innerJoin: () => cadena },
  );
  return cadena;
}

/** Cada `select().from(tabla)` devuelve lo que esa tabla tiene en este momento. */
function txFalsa(estado: { ruta: Filas; paradas: Filas; servicios: Filas; unidades?: Filas }) {
  const tablas = new Map<unknown, () => Filas>([
    [rutas, () => estado.ruta],
    [paradasRuta, () => estado.paradas],
    [assignments, () => estado.servicios],
    [vehicles, () => estado.unidades ?? []],
  ]);
  const escrituras: { op: string; tabla: unknown; valores: Record<string, unknown> }[] = [];
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn((tabla: unknown) => consulta(tablas.get(tabla)?.() ?? [])),
    })),
    insert: vi.fn((tabla: unknown) => ({
      values: vi.fn(async (valores: Record<string, unknown>) => {
        escrituras.push({ op: 'insert', tabla, valores });
      }),
    })),
    update: vi.fn((tabla: unknown) => ({
      set: vi.fn((valores: Record<string, unknown>) => {
        escrituras.push({ op: 'update', tabla, valores });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  return { tx: tx as never, escrituras };
}

const RECOGIDO = new Date('2026-11-01T12:00:00Z');
const ENTREGADO = new Date('2026-11-01T18:00:00Z');
const CANCELADO = new Date('2026-11-01T15:00:00Z');

const RUTA = {
  id: 'ruta-1',
  empresaId: 'empresa-1',
  vehicleId: 'veh-1',
  unidadArrastreId: null,
  driverUserId: 'conductor-1',
  status: 'planificada',
  startedAt: null,
  closedAt: null,
  cancelledAt: null,
};
const parada = (id: string, tripId: string, tipo: string, resolvedAt: Date | null = null) => ({
  id,
  rutaId: 'ruta-1',
  tripId,
  tipo,
  resolvedAt,
});
const PARADAS = [
  parada('p-a1', 'viaje-a', 'recogida'),
  parada('p-b1', 'viaje-b', 'recogida'),
  parada('p-a2', 'viaje-a', 'entrega'),
  parada('p-b2', 'viaje-b', 'entrega'),
];
const servicio = (letra: string, cambios: Record<string, unknown> = {}) => ({
  asignacionId: `asig-${letra}`,
  tripId: `viaje-${letra}`,
  empresaId: 'empresa-1',
  estado: 'asignado',
  pickedUpAt: null,
  deliveredAt: null,
  cancelledAt: null,
  tipoCarga: 'carga_seca',
  pesoKg: 1000,
  volumenM3: null,
  ...cambios,
});
const MOTRIZ = {
  id: 'veh-1',
  unitCategory: 'motriz',
  unitType: 'camion_rigido',
  bodyType: 'plano',
  capacityKg: 5000,
  capacityM3: 40,
} as const;
const fila = (letra: string, cambios: Record<string, unknown> = {}) =>
  ({
    id: `asig-${letra}`,
    tripId: `viaje-${letra}`,
    empresaId: 'empresa-1',
    vehicleId: 'veh-1',
    unidadArrastreId: null,
    driverUserId: 'conductor-1',
    rutaId: 'ruta-1',
    status: 'asignado',
    acceptedAt: new Date('2026-10-31T10:00:00Z'),
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    ...cambios,
  }) as never;

const actualizaciones = (escrituras: { op: string; tabla: unknown }[], tabla: unknown) =>
  escrituras.filter((e) => e.op === 'update' && e.tabla === tabla);

describe('ruta compartida: la ruta se pone al día desde las asignaciones', () => {
  it('una recogida resuelve su parada y pone la ruta en curso', async () => {
    const estado = {
      ruta: [RUTA],
      paradas: PARADAS,
      servicios: [servicio('a', { estado: 'recogido', pickedUpAt: RECOGIDO }), servicio('b')],
    };
    const { tx, escrituras } = txFalsa(estado);
    const r = await sincronizarFila(tx, fila('a', { status: 'recogido', pickedUpAt: RECOGIDO }), {
      origen: 'recogida_confirmada',
      userId: 'oficina',
    });

    expect(r).toEqual({
      tipo: 'conciliada',
      rutaId: 'ruta-1',
      desde: 'planificada',
      hacia: 'planificada',
    });
    // La base falsa no relee la parada escrita: el estado se prueba en integración.
    expect(actualizaciones(escrituras, paradasRuta)).toEqual([
      { op: 'update', tabla: paradasRuta, valores: { resolvedAt: RECOGIDO } },
    ]);
  });

  it('con las paradas ya resueltas, pasa de planificada a cerrada en una sola pasada', async () => {
    const { tx, escrituras } = txFalsa({
      ruta: [RUTA],
      paradas: [
        parada('p-a1', 'viaje-a', 'recogida', RECOGIDO),
        parada('p-b1', 'viaje-b', 'recogida'),
        parada('p-a2', 'viaje-a', 'entrega', ENTREGADO),
        parada('p-b2', 'viaje-b', 'entrega'),
      ],
      servicios: [
        servicio('a', { estado: 'entregado', pickedUpAt: RECOGIDO, deliveredAt: ENTREGADO }),
        servicio('b', { estado: 'cancelado', cancelledAt: CANCELADO }),
      ],
    });
    const r = await sincronizarFila(
      tx,
      fila('a', { status: 'entregado', pickedUpAt: RECOGIDO, deliveredAt: ENTREGADO }),
      { origen: 'entrega_confirmada', userId: null },
    );

    expect(r).toEqual({
      tipo: 'conciliada',
      rutaId: 'ruta-1',
      desde: 'planificada',
      hacia: 'cerrada',
    });
    expect(actualizaciones(escrituras, rutas)[0]?.valores).toMatchObject({
      status: 'cerrada',
      startedAt: RECOGIDO,
      closedAt: ENTREGADO,
      cancelledAt: null,
    });
    expect(escrituras.at(-1)).toMatchObject({
      tabla: eventosRuta,
      valores: {
        tipo: 'estado_cambiado',
        payload: { desde: 'planificada', hacia: 'cerrada', origen: 'entrega_confirmada' },
      },
    });
  });

  it('todas canceladas sin recoger: la ruta queda cancelada con la última fecha', async () => {
    const { tx, escrituras } = txFalsa({
      ruta: [RUTA],
      paradas: PARADAS,
      servicios: [
        servicio('a', { estado: 'cancelado', cancelledAt: RECOGIDO }),
        servicio('b', { estado: 'cancelado', cancelledAt: CANCELADO }),
      ],
    });
    const r = await sincronizarFila(
      tx,
      fila('b', { status: 'cancelado', cancelledAt: CANCELADO }),
      {
        origen: 'carga_cancelada',
        userId: 'oficina',
      },
    );
    expect(r).toMatchObject({ tipo: 'conciliada', hacia: 'cancelada' });
    expect(actualizaciones(escrituras, rutas)[0]?.valores).toMatchObject({
      status: 'cancelada',
      startedAt: null,
      cancelledAt: CANCELADO,
    });
  });

  it('asignar conductor lo declara en la ruta y en sus asignaciones vivas', async () => {
    const { tx, escrituras } = txFalsa({
      ruta: [RUTA],
      paradas: PARADAS,
      servicios: [servicio('a'), servicio('b')],
    });
    const r = await sincronizarFila(tx, fila('a', { driverUserId: 'relevo' }), {
      origen: 'conductor_asignado',
      userId: 'oficina',
    });
    expect(r).toMatchObject({ tipo: 'conciliada', desde: 'planificada', hacia: 'planificada' });
    expect(actualizaciones(escrituras, rutas)[0]?.valores).toMatchObject({
      driverUserId: 'relevo',
    });
    expect(actualizaciones(escrituras, assignments)[0]?.valores).toMatchObject({
      driverUserId: 'relevo',
    });
    expect(escrituras.at(-1)).toMatchObject({
      tabla: eventosRuta,
      valores: {
        tipo: 'configuracion_declarada',
        payload: { vehiculo_id: 'veh-1', conductor_id: 'relevo', origen: 'conductor_asignado' },
      },
    });
  });

  it('otra escritura no copia el conductor de la asignación a la ruta', async () => {
    const { tx, escrituras } = txFalsa({
      ruta: [RUTA],
      paradas: PARADAS,
      servicios: [servicio('a'), servicio('b')],
    });
    const r = await sincronizarFila(tx, fila('a', { driverUserId: 'atrasado' }), {
      origen: 'recogida_confirmada',
      userId: null,
    });
    expect(r).toEqual({ tipo: 'sin_cambios', rutaId: 'ruta-1' });
    expect(escrituras).toEqual([]);
  });

  it('sin conductor en la ruta, la recogida no se resuelve y se informa', async () => {
    const { tx, escrituras } = txFalsa({
      ruta: [{ ...RUTA, driverUserId: null }],
      paradas: PARADAS,
      servicios: [servicio('a', { estado: 'recogido', pickedUpAt: RECOGIDO }), servicio('b')],
    });
    const r = await sincronizarFila(
      tx,
      fila('a', { status: 'recogido', pickedUpAt: RECOGIDO, driverUserId: null }),
      { origen: 'recogida_confirmada', userId: null },
    );
    expect(r).toMatchObject({ tipo: 'omitida' });
    expect(escrituras).toEqual([]);
  });

  it('sin vehículo, una ruta con una recogida resuelta no pasa a en curso', async () => {
    const { tx, escrituras } = txFalsa({
      ruta: [{ ...RUTA, vehicleId: null }],
      paradas: [parada('p-a1', 'viaje-a', 'recogida', RECOGIDO), ...PARADAS.slice(1)],
      servicios: [servicio('a', { estado: 'recogido', pickedUpAt: RECOGIDO }), servicio('b')],
    });
    const r = await sincronizarFila(tx, fila('a', { status: 'recogido', pickedUpAt: RECOGIDO }), {
      origen: 'recogida_confirmada',
      userId: null,
    });
    expect(r).toMatchObject({ tipo: 'omitida' });
    expect(actualizaciones(escrituras, rutas)).toEqual([]);
  });

  it('paradas de un servicio cuya asignación no apunta a la ruta: no se toca', async () => {
    const { tx, escrituras } = txFalsa({
      ruta: [RUTA],
      paradas: PARADAS,
      servicios: [servicio('a')],
    });
    const r = await sincronizarFila(tx, fila('a'), { origen: 'relleno', userId: null });
    expect(r).toMatchObject({ tipo: 'omitida', motivo: expect.stringMatching(/otros servicios/) });
    expect(escrituras).toEqual([]);
  });

  it('una ruta sin las paradas del servicio se omite', async () => {
    const { tx } = txFalsa({ ruta: [RUTA], paradas: PARADAS.slice(1, 2), servicios: [] });
    const r = await sincronizarFila(tx, fila('a'), { origen: 'relleno', userId: null });
    expect(r).toMatchObject({
      tipo: 'omitida',
      motivo: expect.stringMatching(/no tiene las paradas/),
    });
  });
});

describe('cargarRuta', () => {
  it('arma la ruta del paquete con la capacidad de sus unidades', async () => {
    const { tx } = txFalsa({
      ruta: [RUTA],
      paradas: PARADAS,
      // Llegan desordenados: salen en el orden de su recogida.
      servicios: [servicio('b', { estado: 'cancelado' }), servicio('a')],
      unidades: [MOTRIZ],
    });
    const cargada = await cargarRuta(tx, 'ruta-1', { paraActualizar: true });
    expect(cargada?.ruta).toMatchObject({
      empresaId: 'empresa-1',
      estado: 'planificada',
      tieneConductor: true,
      configuracion: { capacidadKg: 5000, capacidadM3: 40, carrocerias: ['plano'] },
    });
    expect(cargada?.ruta.servicios.map((s) => [s.servicioId, s.cancelado])).toEqual([
      ['viaje-a', false],
      ['viaje-b', true],
    ]);
    expect(cargada?.servicios.map((s) => s.asignacionId)).toEqual(['asig-a', 'asig-b']);
  });

  it('sin vehículo declarado no consulta unidades y no hay configuración', async () => {
    const { tx } = txFalsa({
      ruta: [{ ...RUTA, vehicleId: null, driverUserId: null }],
      paradas: PARADAS,
      servicios: [servicio('a'), servicio('b')],
    });
    const cargada = await cargarRuta(tx, 'ruta-1');
    expect(cargada?.ruta).toMatchObject({ configuracion: null, tieneConductor: false });
  });

  it('una ruta que no existe es null', async () => {
    const { tx } = txFalsa({ ruta: [], paradas: [], servicios: [] });
    expect(await cargarRuta(tx, 'x')).toBeNull();
  });
});

describe('configuracionDe', () => {
  const SEMI = {
    ...MOTRIZ,
    id: 'semi',
    unitCategory: 'arrastre',
    unitType: 'semirremolque',
    capacityKg: 28000,
  } as const;
  const REMOLQUE = { ...SEMI, id: 'rem', unitType: 'remolque', capacityKg: 9000 } as const;

  it('rígido con remolque suma; con un arrastre que no compone, mide la motriz sola', () => {
    expect(configuracionDe(MOTRIZ, REMOLQUE)?.capacidadKg).toBe(14000);
    expect(configuracionDe(MOTRIZ, SEMI)?.capacidadKg).toBe(5000);
    expect(configuracionDe(MOTRIZ, { ...REMOLQUE, unitCategory: 'motriz' })?.capacidadKg).toBe(
      5000,
    );
  });

  it('sin motriz, o con una unidad que no es motriz, no hay configuración', () => {
    expect(configuracionDe(undefined, undefined)).toBeNull();
    expect(configuracionDe(SEMI, undefined)).toBeNull();
  });
});

describe('pesoQueNoCabeEnLaRuta', () => {
  const estado = {
    ruta: [RUTA],
    paradas: PARADAS,
    servicios: [servicio('a', { pesoKg: 1000 }), servicio('b', { pesoKg: 2000 })],
    unidades: [MOTRIZ],
  };

  it('mide el tramo más cargado con el peso nuevo', async () => {
    const { tx } = txFalsa(estado);
    expect(
      await pesoQueNoCabeEnLaRuta(tx, { rutaId: 'ruta-1', tripId: 'viaje-b', pesoKg: 4000 }),
    ).toBeNull();
    expect(
      await pesoQueNoCabeEnLaRuta(tx, { rutaId: 'ruta-1', tripId: 'viaje-b', pesoKg: 6000 }),
    ).toEqual({
      capacidadKg: 5000,
      masaKg: 7000,
    });
  });

  it('un servicio que viaja solo, o una ruta que no existe, no se mide aquí', async () => {
    const sola = txFalsa({
      ...estado,
      servicios: [servicio('a'), servicio('b', { estado: 'cancelado' })],
    });
    expect(
      await pesoQueNoCabeEnLaRuta(sola.tx, { rutaId: 'ruta-1', tripId: 'viaje-a', pesoKg: 99_000 }),
    ).toBeNull();
    const nada = txFalsa({ ruta: [], paradas: [], servicios: [] });
    expect(
      await pesoQueNoCabeEnLaRuta(nada.tx, { rutaId: 'x', tripId: 'y', pesoKg: 1 }),
    ).toBeNull();
  });
});
