import { describe, expect, it, vi } from 'vitest';
import { assignments, eventosRuta, paradasRuta, rutas } from '../../src/db/schema.js';
import { VerificacionRellenoError, rellenarRutas } from '../../src/services/rellenar-rutas.js';
import {
  type AsignacionParaRuta,
  rutaQueCorresponde,
} from '../../src/services/sincronizar-ruta-de-asignacion.js';

const RECOGIDO = new Date('2026-11-01T12:00:00Z');
const ENTREGADO = new Date('2026-11-01T18:00:00Z');
const CANCELADO = new Date('2026-11-01T15:00:00Z');

function asignacion(cambios: Partial<AsignacionParaRuta>): AsignacionParaRuta {
  return {
    status: 'asignado',
    driverUserId: 'conductor-1',
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    ...cambios,
  };
}

describe('rutaQueCorresponde', () => {
  it('asignada: ruta planificada, sin paradas resueltas', () => {
    expect(rutaQueCorresponde(asignacion({}))).toEqual({
      ok: true,
      plan: {
        estado: 'planificada',
        iniciadaEn: null,
        cerradaEn: null,
        canceladaEn: null,
        recogidaResueltaEn: null,
        entregaResueltaEn: null,
      },
    });
  });

  it('asignada sin conductor: también planificada', () => {
    const r = rutaQueCorresponde(asignacion({ driverUserId: null }));
    expect(r).toMatchObject({ ok: true, plan: { estado: 'planificada' } });
  });

  it('recogida: ruta en curso desde la recogida, con esa parada resuelta', () => {
    expect(rutaQueCorresponde(asignacion({ status: 'recogido', pickedUpAt: RECOGIDO }))).toEqual({
      ok: true,
      plan: {
        estado: 'en_curso',
        iniciadaEn: RECOGIDO,
        cerradaEn: null,
        canceladaEn: null,
        recogidaResueltaEn: RECOGIDO,
        entregaResueltaEn: null,
      },
    });
  });

  it('entregada: ruta cerrada en la entrega, con las dos paradas resueltas', () => {
    expect(
      rutaQueCorresponde(
        asignacion({ status: 'entregado', pickedUpAt: RECOGIDO, deliveredAt: ENTREGADO }),
      ),
    ).toEqual({
      ok: true,
      plan: {
        estado: 'cerrada',
        iniciadaEn: RECOGIDO,
        cerradaEn: ENTREGADO,
        canceladaEn: null,
        recogidaResueltaEn: RECOGIDO,
        entregaResueltaEn: ENTREGADO,
      },
    });
  });

  it('entregada sin conductor: cerrada igual (el invariante es de la ruta en curso)', () => {
    const r = rutaQueCorresponde(
      asignacion({
        status: 'entregado',
        driverUserId: null,
        pickedUpAt: RECOGIDO,
        deliveredAt: ENTREGADO,
      }),
    );
    expect(r).toMatchObject({ ok: true, plan: { estado: 'cerrada' } });
  });

  it('cancelada antes de recoger: ruta cancelada', () => {
    expect(rutaQueCorresponde(asignacion({ status: 'cancelado', cancelledAt: CANCELADO }))).toEqual(
      {
        ok: true,
        plan: {
          estado: 'cancelada',
          iniciadaEn: null,
          cerradaEn: null,
          canceladaEn: CANCELADO,
          recogidaResueltaEn: null,
          entregaResueltaEn: null,
        },
      },
    );
  });

  it('cancelada después de recoger: la ruta empezó, así que se cierra', () => {
    expect(
      rutaQueCorresponde(
        asignacion({ status: 'cancelado', pickedUpAt: RECOGIDO, cancelledAt: CANCELADO }),
      ),
    ).toEqual({
      ok: true,
      plan: {
        estado: 'cerrada',
        iniciadaEn: RECOGIDO,
        cerradaEn: CANCELADO,
        canceladaEn: null,
        recogidaResueltaEn: RECOGIDO,
        entregaResueltaEn: null,
      },
    });
  });

  it.each([
    ['recogida sin fecha de recogida', asignacion({ status: 'recogido' })],
    [
      'recogida sin conductor',
      asignacion({ status: 'recogido', driverUserId: null, pickedUpAt: RECOGIDO }),
    ],
    [
      'entregada sin fecha de recogida',
      asignacion({ status: 'entregado', deliveredAt: ENTREGADO }),
    ],
    ['entregada sin fecha de entrega', asignacion({ status: 'entregado', pickedUpAt: RECOGIDO })],
    ['cancelada sin fecha de cancelación', asignacion({ status: 'cancelado' })],
  ])('%s: no se rellena y dice por qué', (_nombre, a) => {
    const r = rutaQueCorresponde(a);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// rellenarRutas con una base falsa. El comportamiento contra PostgreSQL real
// está en test/integration/rellenar-rutas.integration.test.ts.
// ---------------------------------------------------------------------------

type Filas = Record<string, unknown>[];

/** Una consulta encadenable que resuelve a `filas`. */
function consulta(filas: Filas) {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    {
      where: () => cadena,
      orderBy: () => cadena,
      for: () => cadena,
      innerJoin: () => cadena,
    },
  );
  return cadena;
}

/** Base falsa: cada `select().from(tabla)` consume la siguiente respuesta de esa tabla. */
function baseFalsa(respuestas: {
  asignaciones: Filas[];
  rutas?: Filas[];
  paradas?: Filas[];
  rutaInsertada?: Filas;
}) {
  const colas = new Map<unknown, Filas[]>([
    [assignments, [...respuestas.asignaciones]],
    [rutas, [...(respuestas.rutas ?? [])]],
    [paradasRuta, [...(respuestas.paradas ?? [])]],
  ]);
  const escrituras: { op: string; tabla: unknown; valores: unknown }[] = [];
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn((tabla: unknown) => consulta(colas.get(tabla)?.shift() ?? [])),
    })),
    insert: vi.fn((tabla: unknown) => ({
      values: vi.fn((valores: unknown) => {
        escrituras.push({ op: 'insert', tabla, valores });
        return Object.assign(Promise.resolve(undefined), {
          returning: vi.fn(async () => respuestas.rutaInsertada ?? [{ id: 'ruta-nueva' }]),
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
  const db = { transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)) };
  return { db: db as never, escrituras };
}

const FILA = {
  id: 'asig-1',
  tripId: 'viaje-1',
  empresaId: 'empresa-1',
  vehicleId: 'veh-1',
  unidadArrastreId: null,
  driverUserId: 'conductor-1',
  rutaId: null,
  status: 'entregado',
  acceptedAt: new Date('2026-10-31T10:00:00Z'),
  pickedUpAt: RECOGIDO,
  deliveredAt: ENTREGADO,
  cancelledAt: null,
};
const RUTA = {
  id: 'ruta-1',
  empresaId: 'empresa-1',
  vehicleId: 'veh-1',
  unidadArrastreId: null,
  driverUserId: null,
  status: 'planificada',
  startedAt: null,
  closedAt: null,
  cancelledAt: null,
};
const PARADAS = [
  { id: 'p-0', orden: 0, tipo: 'recogida', tripId: 'viaje-1', resolvedAt: null },
  { id: 'p-1', orden: 1, tipo: 'entrega', tripId: 'viaje-1', resolvedAt: null },
];
/** Las dos consultas de la verificación final, sin hallazgos. */
const VERIFICACION_LIMPIA: Filas[] = [[], []];

describe('rellenarRutas', () => {
  it('crea la ruta de una asignación que no la tiene, con su estado y sus fechas', async () => {
    const { db, escrituras } = baseFalsa({ asignaciones: [[FILA], ...VERIFICACION_LIMPIA] });
    const r = await rellenarRutas(db, { dryRun: false });

    expect(r).toEqual({
      dryRun: false,
      revisadas: 1,
      creadas: [{ asignacionId: 'asig-1', rutaId: 'ruta-nueva', estado: 'cerrada' }],
      conciliadas: [],
      sinCambios: 0,
      omitidas: [],
    });
    expect(escrituras).toEqual([
      {
        op: 'insert',
        tabla: rutas,
        valores: {
          empresaId: 'empresa-1',
          vehicleId: 'veh-1',
          unidadArrastreId: null,
          driverUserId: 'conductor-1',
          status: 'cerrada',
          startedAt: RECOGIDO,
          closedAt: ENTREGADO,
          cancelledAt: null,
          createdAt: FILA.acceptedAt,
        },
      },
      {
        op: 'insert',
        tabla: paradasRuta,
        valores: [
          {
            rutaId: 'ruta-nueva',
            orden: 0,
            tipo: 'recogida',
            tripId: 'viaje-1',
            resolvedAt: RECOGIDO,
          },
          {
            rutaId: 'ruta-nueva',
            orden: 1,
            tipo: 'entrega',
            tripId: 'viaje-1',
            resolvedAt: ENTREGADO,
          },
        ],
      },
      {
        op: 'insert',
        tabla: eventosRuta,
        valores: {
          rutaId: 'ruta-nueva',
          tipo: 'ruta_creada',
          payload: { viaje_id: 'viaje-1', asignacion_id: 'asig-1', origen: 'relleno' },
          recordedByUserId: null,
        },
      },
      { op: 'update', tabla: assignments, valores: { rutaId: 'ruta-nueva' } },
    ]);
  });

  it('falla si la base no devuelve la ruta insertada', async () => {
    const { db } = baseFalsa({ asignaciones: [[FILA]], rutaInsertada: [] });
    await expect(rellenarRutas(db, { dryRun: false })).rejects.toThrow(/no row/);
  });

  it('pone al día la ruta que quedó atrás de su asignación', async () => {
    const { db, escrituras } = baseFalsa({
      asignaciones: [[{ ...FILA, rutaId: 'ruta-1' }], ...VERIFICACION_LIMPIA],
      rutas: [[RUTA]],
      paradas: [PARADAS],
    });
    const r = await rellenarRutas(db, { dryRun: false });

    expect(r.conciliadas).toEqual([
      { asignacionId: 'asig-1', rutaId: 'ruta-1', desde: 'planificada', hacia: 'cerrada' },
    ]);
    expect(escrituras.map((e) => [e.op, e.tabla])).toEqual([
      ['update', rutas],
      ['update', paradasRuta],
      ['update', paradasRuta],
      ['insert', eventosRuta],
      ['insert', eventosRuta],
    ]);
    expect(escrituras[0]?.valores).toMatchObject({
      status: 'cerrada',
      driverUserId: 'conductor-1',
      startedAt: RECOGIDO,
      closedAt: ENTREGADO,
    });
    expect(escrituras[3]?.valores).toMatchObject({
      tipo: 'estado_cambiado',
      payload: { desde: 'planificada', hacia: 'cerrada', origen: 'relleno' },
    });
    expect(escrituras[4]?.valores).toMatchObject({
      tipo: 'configuracion_declarada',
      payload: { vehiculo_id: 'veh-1', conductor_id: 'conductor-1', origen: 'relleno' },
    });
  });

  it('si solo cambió el conductor, no registra un cambio de estado', async () => {
    const { db, escrituras } = baseFalsa({
      asignaciones: [
        [{ ...FILA, rutaId: 'ruta-1', status: 'asignado', pickedUpAt: null, deliveredAt: null }],
        ...VERIFICACION_LIMPIA,
      ],
      rutas: [[RUTA]],
      paradas: [PARADAS],
    });
    const r = await rellenarRutas(db, { dryRun: false });

    expect(r.conciliadas).toHaveLength(1);
    const eventos = escrituras.filter((e) => e.tabla === eventosRuta);
    expect(eventos.map((e) => (e.valores as { tipo: string }).tipo)).toEqual([
      'configuracion_declarada',
    ]);
  });

  it('no toca la ruta que ya está al día', async () => {
    const { db, escrituras } = baseFalsa({
      asignaciones: [
        [
          {
            ...FILA,
            rutaId: 'ruta-1',
            status: 'asignado',
            driverUserId: null,
            pickedUpAt: null,
            deliveredAt: null,
          },
        ],
        ...VERIFICACION_LIMPIA,
      ],
      rutas: [[RUTA]],
      paradas: [PARADAS],
    });
    const r = await rellenarRutas(db, { dryRun: false });

    expect(r).toMatchObject({ sinCambios: 1, creadas: [], conciliadas: [], omitidas: [] });
    expect(escrituras).toEqual([]);
  });

  it('omite la ruta que lleva paradas de otros servicios', async () => {
    const CON_AJENA = [...PARADAS, { id: 'p-2', orden: 2, tipo: 'recogida', tripId: 'viaje-2' }];
    const { db, escrituras } = baseFalsa({
      // La ruta compartida se vuelve a cargar entera: ruta, paradas y sus asignaciones.
      asignaciones: [
        [{ ...FILA, rutaId: 'ruta-1' }],
        [
          {
            asignacionId: 'asig-1',
            tripId: 'viaje-1',
            empresaId: 'empresa-1',
            estado: 'entregado',
          },
        ],
        ...VERIFICACION_LIMPIA,
      ],
      rutas: [[RUTA], [RUTA]],
      paradas: [CON_AJENA, CON_AJENA],
    });
    const r = await rellenarRutas(db, { dryRun: false });

    expect(r.omitidas).toEqual([
      {
        asignacionId: 'asig-1',
        motivo: 'la ruta tiene paradas de otros servicios cuya asignación no apunta a ella',
      },
    ]);
    expect(escrituras).toEqual([]);
  });

  it('omite la ruta que va más adelante que su asignación', async () => {
    const { db, escrituras } = baseFalsa({
      asignaciones: [
        [{ ...FILA, rutaId: 'ruta-1', status: 'asignado', pickedUpAt: null, deliveredAt: null }],
        ...VERIFICACION_LIMPIA,
      ],
      rutas: [[{ ...RUTA, status: 'en_curso' }]],
      paradas: [PARADAS],
    });
    const r = await rellenarRutas(db, { dryRun: false });

    expect(r.omitidas).toEqual([
      { asignacionId: 'asig-1', motivo: 'la ruta está en_curso y la asignación pide planificada' },
    ]);
    expect(escrituras).toEqual([]);
  });

  it('omite la asignación con datos que no cuadran', async () => {
    const { db, escrituras } = baseFalsa({
      asignaciones: [[{ ...FILA, pickedUpAt: null }], ...VERIFICACION_LIMPIA],
    });
    const r = await rellenarRutas(db, { dryRun: false });

    expect(r.omitidas).toEqual([
      { asignacionId: 'asig-1', motivo: 'entregada sin fecha de recogida' },
    ]);
    expect(escrituras).toEqual([]);
  });

  it('falla si la asignación apunta a una ruta que no existe', async () => {
    const { db } = baseFalsa({ asignaciones: [[{ ...FILA, rutaId: 'ruta-x' }]], rutas: [[]] });
    await expect(rellenarRutas(db, { dryRun: false })).rejects.toThrow(/no existe/);
  });

  it('falla sin escribir si la verificación encuentra una asignación sin ruta', async () => {
    const { db } = baseFalsa({ asignaciones: [[], [{ id: 'asig-9' }], []] });
    await expect(rellenarRutas(db, { dryRun: false })).rejects.toBeInstanceOf(
      VerificacionRellenoError,
    );
  });

  it('falla sin escribir si la verificación encuentra una ruta distinta de su asignación', async () => {
    const { db } = baseFalsa({ asignaciones: [[], [], [{ id: 'asig-9' }]] });
    await expect(rellenarRutas(db, { dryRun: true })).rejects.toThrow(/1 rutas distintas/);
  });

  it('en seco devuelve el resultado y deshace la transacción', async () => {
    const { db } = baseFalsa({ asignaciones: [[FILA], ...VERIFICACION_LIMPIA] });
    const r = await rellenarRutas(db, { dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(r.creadas).toHaveLength(1);
    const transaccion = (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction;
    await expect(transaccion.mock.results[0]?.value).rejects.toThrow();
  });
});
