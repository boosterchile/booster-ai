import { describe, expect, it, vi } from 'vitest';
import {
  assignments,
  conductores,
  eventosRuta,
  metricasRuta,
  paradasRuta,
  rutas,
  tripMetrics,
  trips,
  users,
  vehicles,
} from '../../src/db/schema.js';
import {
  agruparServicio,
  declararConfiguracionDeRuta,
  listarRutas,
  quitarServicioDeRuta,
  reordenarParadasDeRuta,
  verRuta,
} from '../../src/services/operar-ruta.js';

// El recorrido contra PostgreSQL está en
// test/integration/rutas-api.integration.test.ts; aquí, las ramas.

type Filas = Record<string, unknown>[];

function consulta(filas: Filas) {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    {
      where: () => cadena,
      orderBy: () => cadena,
      for: () => cadena,
      innerJoin: () => cadena,
      leftJoin: () => cadena,
      limit: () => cadena,
    },
  );
  return cadena;
}

/**
 * Base falsa: cada `select().from(tabla)` consume la siguiente respuesta de
 * esa tabla; la última se repite.
 */
function baseFalsa(respuestas: Partial<Record<string, Filas[]>>) {
  const nombres = new Map<unknown, string>([
    [rutas, 'rutas'],
    [paradasRuta, 'paradas'],
    [assignments, 'asignaciones'],
    [vehicles, 'unidades'],
    [trips, 'viajes'],
    [users, 'usuarios'],
    [conductores, 'conductores'],
    [metricasRuta, 'metricas_ruta'],
    [tripMetrics, 'metricas_viaje'],
  ]);
  const colas = new Map(Object.entries(respuestas).map(([k, v]) => [k, [...(v ?? [])]]));
  const siguiente = (tabla: unknown): Filas => {
    const cola = colas.get(nombres.get(tabla) ?? '') ?? [];
    return (cola.length > 1 ? cola.shift() : cola[0]) ?? [];
  };
  const escrituras: { op: string; tabla: unknown; valores: unknown }[] = [];
  const tx = {
    select: vi.fn(() => ({ from: vi.fn((tabla: unknown) => consulta(siguiente(tabla))) })),
    insert: vi.fn((tabla: unknown) => ({
      values: vi.fn((valores: unknown) => {
        escrituras.push({ op: 'insert', tabla, valores });
        return Object.assign(Promise.resolve(undefined), {
          returning: vi.fn(async () => [{ id: 'ruta-nueva' }]),
        });
      }),
    })),
    update: vi.fn((tabla: unknown) => ({
      set: vi.fn((valores: unknown) => {
        escrituras.push({ op: 'update', tabla, valores });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  const db = {
    ...tx,
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const de = (op: string, tabla: unknown) =>
    escrituras.filter((e) => e.op === op && e.tabla === tabla).map((e) => e.valores);
  return { db: db as never, escrituras, de };
}

const ruta = (id: string, cambios: Record<string, unknown> = {}) => ({
  id,
  empresaId: 'empresa-1',
  vehicleId: 'veh-1',
  unidadArrastreId: null,
  driverUserId: 'conductor-1',
  status: 'planificada',
  startedAt: null,
  closedAt: null,
  cancelledAt: null,
  createdAt: new Date('2026-11-11T12:00:00Z'),
  ...cambios,
});
const parada = (
  rutaId: string,
  letra: string,
  tipo: 'recogida' | 'entrega',
  orden: number,
  resolvedAt: Date | null = null,
) => ({ id: `p-${letra}-${tipo}`, rutaId, tripId: `viaje-${letra}`, tipo, orden, resolvedAt });
const sola = (rutaId: string, letra: string) => [
  parada(rutaId, letra, 'recogida', 0),
  parada(rutaId, letra, 'entrega', 1),
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
const unidad = (id: string, cambios: Record<string, unknown> = {}) => ({
  id,
  empresaId: 'empresa-1',
  patente: id.toUpperCase(),
  vehicleStatus: 'activo',
  unitCategory: 'motriz',
  unitType: 'camion_rigido',
  bodyType: 'plano',
  capacityKg: 5000,
  capacityM3: null,
  ...cambios,
});
const viaje = (letra: string) => ({
  id: `viaje-${letra}`,
  trackingCode: `BOO-${letra.toUpperCase()}`,
  origen: 'Origen',
  destino: 'Destino',
  ventanaDesde: new Date('2026-11-20T12:00:00Z'),
  ventanaHasta: null,
  pesoKg: 1000,
  volumenM3: null,
});
const JUNTAS = [
  parada('ruta-a', 'a', 'recogida', 0),
  parada('ruta-a', 'b', 'recogida', 1),
  parada('ruta-a', 'b', 'entrega', 2),
  parada('ruta-a', 'a', 'entrega', 3),
];
const BASE = { empresaId: 'empresa-1', userId: 'oficina' };

describe('verRuta y listarRutas', () => {
  it('arma la vista: paradas con su servicio, tramos, capacidad y conductor', async () => {
    const { db } = baseFalsa({
      rutas: [[ruta('ruta-a')]],
      paradas: [JUNTAS],
      asignaciones: [[servicio('a'), servicio('b', { estado: 'cancelado' })]],
      unidades: [[unidad('veh-1')]],
      viajes: [[viaje('a'), viaje('b')]],
      usuarios: [[{ id: 'conductor-1', nombre: 'Juan' }]],
    });
    const r = await verRuta(db, { empresaId: 'empresa-1', rutaId: 'ruta-a' });
    expect(r).toMatchObject({
      ok: true,
      ruta: {
        id: 'ruta-a',
        estado: 'planificada',
        vehiculo: { id: 'veh-1', patente: 'VEH-1' },
        unidad_arrastre: null,
        conductor: { id: 'conductor-1', nombre: 'Juan' },
        capacidad: { kg: 5000, m3: null },
        avisos: [],
      },
    });
    const vista = r.ok ? r.ruta : null;
    expect(vista?.paradas.map((p) => [p.orden, p.tipo, p.servicio.cancelado])).toEqual([
      [0, 'recogida', false],
      [1, 'recogida', true],
      [2, 'entrega', true],
      [3, 'entrega', false],
    ]);
    expect(vista?.paradas[0]?.servicio).toMatchObject({
      asignacion_id: 'asig-a',
      codigo_seguimiento: 'BOO-A',
      direccion: 'Origen',
      ventana: { desde: '2026-11-20T12:00:00.000Z', hasta: null },
    });
    expect(vista?.paradas[3]?.servicio).toMatchObject({ direccion: 'Destino', ventana: null });
    // El servicio cancelado sin recoger no cuenta a bordo.
    expect(vista?.tramos.map((t) => t.masa_kg)).toEqual([1000, 1000, 1000]);
    expect(vista?.huella).toBeNull();
  });

  it('con varias cargas entrega el total de la ruta y la parte de cada una', async () => {
    const { db } = baseFalsa({
      rutas: [[ruta('ruta-a')]],
      paradas: [JUNTAS],
      asignaciones: [[servicio('a'), servicio('b')]],
      unidades: [[unidad('veh-1')]],
      viajes: [[viaje('a'), viaje('b')]],
      usuarios: [[{ id: 'conductor-1', nombre: 'Juan' }]],
      metricas_ruta: [[{ estimadas: '100.000', reales: null }]],
      metricas_viaje: [
        [
          {
            viajeId: 'viaje-a',
            participacion: '40.00',
            estimadas: '40.000',
            reales: null,
          },
          {
            viajeId: 'viaje-b',
            participacion: '60.00',
            estimadas: '60.000',
            reales: null,
          },
        ],
      ],
    });
    const r = await verRuta(db, { empresaId: 'empresa-1', rutaId: 'ruta-a' });
    expect(r.ok && r.ruta.huella).toEqual({
      es_estimacion: true,
      emisiones_kgco2e: '100.000',
      servicios: [
        {
          viaje_id: 'viaje-a',
          codigo_seguimiento: 'BOO-A',
          participacion_pct: '40.00',
          emisiones_kgco2e: '40.000',
        },
        {
          viaje_id: 'viaje-b',
          codigo_seguimiento: 'BOO-B',
          participacion_pct: '60.00',
          emisiones_kgco2e: '60.000',
        },
      ],
    });
  });

  it('sin vehículo ni conductor, y con una parada sin servicio, no inventa nada', async () => {
    const { db } = baseFalsa({
      rutas: [[ruta('ruta-a', { vehicleId: null, driverUserId: null })]],
      paradas: [[...sola('ruta-a', 'a'), parada('ruta-a', 'z', 'recogida', 2)]],
      asignaciones: [[servicio('a')]],
      viajes: [[viaje('a')]],
    });
    const r = await verRuta(db, { empresaId: 'empresa-1', rutaId: 'ruta-a' });
    expect(r).toMatchObject({
      ok: true,
      ruta: { vehiculo: null, conductor: null, capacidad: null },
    });
    expect(r.ok && r.ruta.paradas).toHaveLength(2);
  });

  it('la ruta de otra empresa, o una que no existe, no se encuentra', async () => {
    for (const filas of [[ruta('ruta-a', { empresaId: 'otra' })], []]) {
      const { db } = baseFalsa({ rutas: [filas] });
      expect(await verRuta(db, { empresaId: 'empresa-1', rutaId: 'ruta-a' })).toEqual({
        ok: false,
        code: 'ruta_not_found',
      });
    }
  });

  it('listar entrega cada ruta con su vehículo, conductor y conteos', async () => {
    const fila = {
      id: 'ruta-a',
      estado: 'en_curso',
      vehiculoId: 'veh-1',
      arrastreId: null,
      conductorId: 'conductor-1',
      conductorNombre: 'Juan',
      creadaEn: new Date('2026-11-11T12:00:00Z'),
      servicios: 2,
      paradasPendientes: 3,
    };
    const { db } = baseFalsa({
      rutas: [
        [
          fila,
          { ...fila, id: 'ruta-b', vehiculoId: null, conductorId: null, conductorNombre: null },
        ],
      ],
      unidades: [[{ id: 'veh-1', patente: 'ABCD12' }]],
    });
    expect(await listarRutas(db, { empresaId: 'empresa-1', estados: ['en_curso'] })).toEqual([
      {
        id: 'ruta-a',
        estado: 'en_curso',
        vehiculo: { id: 'veh-1', patente: 'ABCD12' },
        unidad_arrastre: null,
        conductor: { id: 'conductor-1', nombre: 'Juan' },
        servicios: 2,
        paradas_pendientes: 3,
        creada_en: '2026-11-11T12:00:00.000Z',
      },
      expect.objectContaining({ id: 'ruta-b', vehiculo: null, conductor: null }),
    ]);
    const vacia = baseFalsa({ rutas: [[]] });
    expect(await listarRutas(vacia.db, { empresaId: 'empresa-1', estados: ['cerrada'] })).toEqual(
      [],
    );
  });
});

describe('agruparServicio', () => {
  const pedir = (db: never) =>
    agruparServicio(db, {
      ...BASE,
      rutaId: 'ruta-a',
      asignacionId: 'asig-b',
      posicion: { recogida: 1, entrega: 2 },
    });
  /** asig-b vive en ruta-b; las rutas se cargan en orden de id: ruta-a y después ruta-b. */
  const escenario = (cambios: Partial<Record<string, Filas[]>> = {}) =>
    baseFalsa({
      asignaciones: [
        [{ id: 'asig-b', tripId: 'viaje-b', rutaId: 'ruta-b' }],
        [servicio('a')],
        [servicio('b')],
        [servicio('a'), servicio('b')],
      ],
      rutas: [[ruta('ruta-a')], [ruta('ruta-b')], [ruta('ruta-a')]],
      paradas: [sola('ruta-a', 'a'), sola('ruta-b', 'b'), JUNTAS],
      unidades: [[unidad('veh-1')]],
      viajes: [[viaje('a'), viaje('b')]],
      usuarios: [[{ id: 'conductor-1', nombre: 'Juan' }]],
      ...cambios,
    });

  it('mueve las paradas y la asignación, cancela el origen y deja los eventos', async () => {
    const { db, de } = escenario();
    const r = await pedir(db);

    expect(r).toMatchObject({ ok: true, ruta: { id: 'ruta-a' } });
    expect(de('update', paradasRuta)).toEqual([
      { rutaId: 'ruta-a', orden: 1 },
      { rutaId: 'ruta-a', orden: 2 },
      { rutaId: 'ruta-a', orden: 3 },
    ]);
    expect(de('update', assignments)).toEqual([
      expect.objectContaining({
        rutaId: 'ruta-a',
        vehicleId: 'veh-1',
        driverUserId: 'conductor-1',
      }),
    ]);
    expect(de('update', rutas)).toEqual([expect.objectContaining({ status: 'cancelada' })]);
    const eventos = de('insert', eventosRuta).flat() as { rutaId: string; tipo: string }[];
    expect(eventos.map((e) => [e.rutaId, e.tipo])).toEqual([
      ['ruta-b', 'estado_cambiado'],
      ['ruta-b', 'servicio_quitado'],
      ['ruta-a', 'servicio_agregado'],
    ]);
  });

  it('una asignación de otra empresa, o sin ruta, no se encuentra', async () => {
    for (const filas of [[], [{ id: 'asig-b', tripId: 'viaje-b', rutaId: null }]]) {
      const { db, escrituras } = baseFalsa({ asignaciones: [filas] });
      expect(await pedir(db)).toEqual({ ok: false, code: 'asignacion_not_found' });
      expect(escrituras).toEqual([]);
    }
  });

  it('si ya está en esa ruta, se rechaza sin cargar nada', async () => {
    const { db } = baseFalsa({
      asignaciones: [[{ id: 'asig-b', tripId: 'viaje-b', rutaId: 'ruta-a' }]],
    });
    expect(await pedir(db)).toEqual({
      ok: false,
      code: 'ruta_invalida',
      violaciones: [{ motivo: 'servicio_ya_en_la_ruta', servicioId: 'viaje-b' }],
    });
  });

  it('la ruta de destino de otra empresa no existe; la de origen ajena tampoco', async () => {
    const destinoAjeno = escenario({
      rutas: [[ruta('ruta-a', { empresaId: 'otra' })], [ruta('ruta-b')]],
    });
    expect(await pedir(destinoAjeno.db)).toEqual({ ok: false, code: 'ruta_not_found' });
    const origenAjeno = escenario({
      rutas: [[ruta('ruta-a')], [ruta('ruta-b', { empresaId: 'otra' })]],
    });
    expect(await pedir(origenAjeno.db)).toEqual({ ok: false, code: 'asignacion_not_found' });
    expect(destinoAjeno.escrituras).toEqual([]);
  });

  it('lo que el paquete rechaza no escribe nada', async () => {
    const { db, escrituras } = escenario({
      asignaciones: [
        [{ id: 'asig-b', tripId: 'viaje-b', rutaId: 'ruta-b' }],
        [servicio('a', { pesoKg: 4500 })],
        [servicio('b')],
      ],
    });
    expect(await pedir(db)).toMatchObject({
      ok: false,
      code: 'ruta_invalida',
      violaciones: [{ motivo: 'capacidad_peso_excedida', masaKg: 5500, capacidadKg: 5000 }],
    });
    expect(escrituras).toEqual([]);
  });
});

describe('quitarServicioDeRuta', () => {
  const pedir = (db: never, asignacionId = 'asig-b') =>
    quitarServicioDeRuta(db, { ...BASE, rutaId: 'ruta-a', asignacionId });
  const escenario = (cambios: Partial<Record<string, Filas[]>> = {}) =>
    baseFalsa({
      rutas: [[ruta('ruta-a')]],
      paradas: [JUNTAS, sola('ruta-a', 'a')],
      asignaciones: [[servicio('a'), servicio('b')], [servicio('a')]],
      unidades: [[unidad('veh-1')]],
      viajes: [[viaje('a')]],
      ...cambios,
    });

  it('crea la ruta propia con el vehículo y el conductor de la ruta, y reordena lo que queda', async () => {
    const { db, de } = escenario();
    const r = await pedir(db);

    expect(r).toMatchObject({ ok: true, rutaNuevaId: 'ruta-nueva', ruta: { id: 'ruta-a' } });
    expect(de('insert', rutas)).toEqual([
      {
        empresaId: 'empresa-1',
        vehicleId: 'veh-1',
        unidadArrastreId: null,
        driverUserId: 'conductor-1',
        status: 'planificada',
      },
    ]);
    expect(de('update', paradasRuta)).toEqual([
      { rutaId: 'ruta-nueva', orden: 0 },
      { rutaId: 'ruta-nueva', orden: 1 },
      { rutaId: 'ruta-a', orden: 1 },
    ]);
    expect(de('update', assignments)).toEqual([
      expect.objectContaining({ rutaId: 'ruta-nueva', vehicleId: 'veh-1' }),
    ]);
    const eventos = de('insert', eventosRuta).flat() as { rutaId: string; tipo: string }[];
    expect(eventos.map((e) => [e.rutaId, e.tipo])).toEqual([
      ['ruta-a', 'servicio_quitado'],
      ['ruta-nueva', 'ruta_creada'],
    ]);
  });

  it('ruta ajena, asignación que no es de la ruta y rechazo del paquete', async () => {
    const ajena = escenario({ rutas: [[ruta('ruta-a', { empresaId: 'otra' })]] });
    expect(await pedir(ajena.db)).toEqual({ ok: false, code: 'ruta_not_found' });
    const otra = escenario();
    expect(await pedir(otra.db, 'asig-z')).toEqual({ ok: false, code: 'asignacion_not_found' });
    const unico = escenario({ paradas: [sola('ruta-a', 'a')], asignaciones: [[servicio('a')]] });
    expect(await pedir(unico.db, 'asig-a')).toMatchObject({
      code: 'ruta_invalida',
      violaciones: [{ motivo: 'servicio_unico_de_la_ruta' }],
    });
    expect([...ajena.escrituras, ...otra.escrituras, ...unico.escrituras]).toEqual([]);
  });

  it('si la ruta original queda sin nada pendiente, se cierra', async () => {
    const R = new Date('2026-11-12T10:00:00Z');
    const { db, de } = escenario({
      rutas: [[ruta('ruta-a', { status: 'en_curso', startedAt: R })]],
      paradas: [
        [
          parada('ruta-a', 'a', 'recogida', 0, R),
          parada('ruta-a', 'a', 'entrega', 1, R),
          parada('ruta-a', 'b', 'recogida', 2),
          parada('ruta-a', 'b', 'entrega', 3),
        ],
        sola('ruta-a', 'a'),
      ],
      asignaciones: [
        [servicio('a', { estado: 'entregado', pickedUpAt: R, deliveredAt: R }), servicio('b')],
        [servicio('a')],
      ],
    });
    expect((await pedir(db)).ok).toBe(true);
    expect(de('update', rutas)).toEqual([expect.objectContaining({ status: 'cerrada' })]);
  });
});

describe('reordenarParadasDeRuta', () => {
  const ids = JUNTAS.map((p) => p.id);
  const escenario = () =>
    baseFalsa({
      rutas: [[ruta('ruta-a')]],
      paradas: [JUNTAS],
      asignaciones: [[servicio('a'), servicio('b')]],
      unidades: [[unidad('veh-1')]],
      viajes: [[viaje('a'), viaje('b')]],
    });
  const pedir = (db: never, paradaIds: string[]) =>
    reordenarParadasDeRuta(db, { ...BASE, rutaId: 'ruta-a', paradaIds });

  it('escribe solo las paradas que cambian de lugar y deja el evento con el antes y el después', async () => {
    const { db, de } = escenario();
    const nuevo = [ids[1], ids[0], ids[2], ids[3]] as string[];
    expect((await pedir(db, nuevo)).ok).toBe(true);
    expect(de('update', paradasRuta)).toEqual([
      { rutaId: 'ruta-a', orden: 0 },
      { rutaId: 'ruta-a', orden: 1 },
    ]);
    expect(de('insert', eventosRuta)).toEqual([
      expect.objectContaining({
        tipo: 'paradas_reordenadas',
        payload: { antes: ids, despues: nuevo, origen: 'api' },
        recordedByUserId: 'oficina',
      }),
    ]);
  });

  it('un id ajeno, uno repetido o un orden que el paquete rechaza no escriben', async () => {
    for (const [orden, motivo] of [
      [[ids[0], ids[1], ids[2], 'ajena'], 'orden_invalido'],
      [[ids[0], ids[0], ids[2], ids[3]], 'orden_invalido'],
      [[ids[2], ids[0], ids[1], ids[3]], 'entrega_antes_de_recogida'],
    ] as const) {
      const { db, escrituras } = escenario();
      expect(await pedir(db, orden as unknown as string[])).toMatchObject({
        code: 'ruta_invalida',
        violaciones: [{ motivo }],
      });
      expect(escrituras).toEqual([]);
    }
    const ajena = baseFalsa({ rutas: [[]] });
    expect(await pedir(ajena.db, ids)).toEqual({ ok: false, code: 'ruta_not_found' });
  });
});

describe('declararConfiguracionDeRuta', () => {
  const escenario = (cambios: Partial<Record<string, Filas[]>> = {}) =>
    baseFalsa({
      rutas: [[ruta('ruta-a')]],
      paradas: [JUNTAS],
      asignaciones: [[servicio('a'), servicio('b')]],
      // cargarRuta lee las unidades de la ruta; después se leen las declaradas.
      unidades: [[unidad('veh-1')], [unidad('veh-2')]],
      viajes: [[viaje('a'), viaje('b')]],
      conductores: [[{ id: 'c-2' }]],
      usuarios: [[{ id: 'relevo', nombre: 'Relevo' }]],
      ...cambios,
    });
  const pedir = (db: never, cambios: Record<string, string | null> = {}) =>
    declararConfiguracionDeRuta(db, {
      ...BASE,
      rutaId: 'ruta-a',
      vehiculoId: 'veh-1',
      unidadArrastreId: null,
      conductorId: 'conductor-1',
      ...cambios,
    });

  it('lo declarado va a la ruta y a sus asignaciones vivas, con su evento', async () => {
    const { db, de } = escenario();
    expect((await pedir(db, { vehiculoId: 'veh-2', conductorId: 'relevo' })).ok).toBe(true);
    const declarado = { vehicleId: 'veh-2', unidadArrastreId: null, driverUserId: 'relevo' };
    expect(de('update', rutas)).toEqual([expect.objectContaining(declarado)]);
    expect(de('update', assignments)).toEqual([expect.objectContaining(declarado)]);
    expect(de('insert', eventosRuta)).toEqual([
      expect.objectContaining({
        tipo: 'configuracion_declarada',
        payload: {
          vehiculo_id: 'veh-2',
          unidad_arrastre_id: null,
          conductor_id: 'relevo',
          origen: 'api',
        },
      }),
    ]);
  });

  it('declarar lo mismo no escribe nada', async () => {
    const { db, escrituras } = escenario();
    expect((await pedir(db)).ok).toBe(true);
    expect(escrituras).toEqual([]);
  });

  it('quitar el conductor de una ruta planificada se acepta', async () => {
    const { db, de } = escenario();
    expect((await pedir(db, { conductorId: null })).ok).toBe(true);
    expect(de('update', rutas)).toEqual([expect.objectContaining({ driverUserId: null })]);
  });

  it.each([
    ['vehículo que no existe', [], { unidad: 'vehiculo', motivo: 'no_es_de_la_flota' }],
    [
      'vehículo de otra empresa',
      [unidad('veh-2', { empresaId: 'otra' })],
      { unidad: 'vehiculo', motivo: 'no_es_de_la_flota' },
    ],
    [
      'vehículo inactivo',
      [unidad('veh-2', { vehicleStatus: 'mantenimiento' })],
      { unidad: 'vehiculo', motivo: 'no_esta_activa' },
    ],
    [
      'vehículo que es un arrastre',
      [unidad('veh-2', { unitCategory: 'arrastre', unitType: 'remolque' })],
      { unidad: 'vehiculo', motivo: 'no_es_motriz' },
    ],
    [
      'arrastre que no existe',
      [unidad('veh-2')],
      { unidad: 'unidad_arrastre', motivo: 'no_es_de_la_flota' },
    ],
    [
      'arrastre inactivo',
      [
        unidad('veh-2'),
        unidad('arr', {
          vehicleStatus: 'retirado',
          unitCategory: 'arrastre',
          unitType: 'remolque',
        }),
      ],
      { unidad: 'unidad_arrastre', motivo: 'no_esta_activa' },
    ],
    [
      'arrastre que es motriz',
      [unidad('veh-2'), unidad('arr')],
      { unidad: 'unidad_arrastre', motivo: 'no_es_arrastre' },
    ],
    [
      'arrastre que no compone',
      [unidad('veh-2'), unidad('arr', { unitCategory: 'arrastre', unitType: 'semirremolque' })],
      { unidad: 'unidad_arrastre', motivo: 'no_compone_con_la_motriz' },
    ],
  ])('%s', async (_nombre, declaradas, esperado) => {
    const { db, escrituras } = escenario({ unidades: [[unidad('veh-1')], declaradas] });
    const conArrastre = esperado.unidad === 'unidad_arrastre';
    const r = await pedir(db, {
      vehiculoId: 'veh-2',
      unidadArrastreId: conArrastre ? 'arr' : null,
    });
    expect(r).toEqual({ ok: false, code: 'vehiculo_no_asignable', ...esperado });
    expect(escrituras).toEqual([]);
  });

  it('un rígido con su remolque suma capacidad', async () => {
    const { db, de } = escenario({
      unidades: [
        [unidad('veh-1')],
        [unidad('veh-2'), unidad('arr', { unitCategory: 'arrastre', unitType: 'remolque' })],
      ],
    });
    expect((await pedir(db, { vehiculoId: 'veh-2', unidadArrastreId: 'arr' })).ok).toBe(true);
    expect(de('update', rutas)).toEqual([expect.objectContaining({ unidadArrastreId: 'arr' })]);
  });

  it('un vehículo que no alcanza, o un conductor ajeno, no escriben', async () => {
    const chico = escenario({
      unidades: [[unidad('veh-1')], [unidad('veh-2', { capacityKg: 1500 })]],
    });
    expect(await pedir(chico.db, { vehiculoId: 'veh-2' })).toMatchObject({
      code: 'ruta_invalida',
      violaciones: [{ motivo: 'capacidad_peso_excedida', masaKg: 2000, capacidadKg: 1500 }],
    });
    const ajeno = escenario({ conductores: [[]] });
    expect(await pedir(ajeno.db, { conductorId: 'de-otra' })).toEqual({
      ok: false,
      code: 'conductor_no_asignable',
    });
    expect([...chico.escrituras, ...ajeno.escrituras]).toEqual([]);
  });

  it('con la ruta en curso no queda sin conductor; una ruta ajena no existe', async () => {
    const R = new Date('2026-11-12T10:00:00Z');
    const enCurso = escenario({
      rutas: [[ruta('ruta-a', { status: 'en_curso', startedAt: R })]],
      paradas: [[{ ...JUNTAS[0], resolvedAt: R }, ...JUNTAS.slice(1)] as Filas],
    });
    expect(await pedir(enCurso.db, { conductorId: null })).toMatchObject({
      code: 'ruta_invalida',
      violaciones: [{ motivo: 'en_curso_sin_conductor' }],
    });
    const ajena = escenario({ rutas: [[ruta('ruta-a', { empresaId: 'otra' })]] });
    expect(await pedir(ajena.db)).toEqual({ ok: false, code: 'ruta_not_found' });
  });
});
