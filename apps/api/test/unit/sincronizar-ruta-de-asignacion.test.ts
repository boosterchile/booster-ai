import { describe, expect, it, vi } from 'vitest';
import { assignments, eventosRuta, paradasRuta, rutas } from '../../src/db/schema.js';
import { sincronizarRutaDeAsignacion } from '../../src/services/sincronizar-ruta-de-asignacion.js';

// El recorrido completo contra PostgreSQL está en
// test/integration/ruta-sigue-asignacion.integration.test.ts; el resto de la
// regla (crear, conciliar, omitir) se prueba en rellenar-rutas.test.ts.

type Filas = Record<string, unknown>[];

function consulta(filas: Filas) {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    {
      where: () => cadena,
      orderBy: () => cadena,
      for: () => cadena,
    },
  );
  return cadena;
}

function txFalsa(respuestas: { asignacion: Filas; ruta?: Filas; paradas?: Filas }) {
  const colas = new Map<unknown, Filas>([
    [assignments, respuestas.asignacion],
    [rutas, respuestas.ruta ?? []],
    [paradasRuta, respuestas.paradas ?? []],
  ]);
  const escrituras: { op: string; tabla: unknown; valores: unknown }[] = [];
  const tx = {
    select: vi.fn(() => ({ from: vi.fn((tabla: unknown) => consulta(colas.get(tabla) ?? [])) })),
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
  return { tx: tx as never, escrituras };
}

const RECOGIDO = new Date('2026-11-01T12:00:00Z');
const FILA = {
  id: 'asig-1',
  tripId: 'viaje-1',
  empresaId: 'empresa-1',
  vehicleId: 'veh-2',
  unidadArrastreId: null,
  driverUserId: null,
  rutaId: 'ruta-1',
  status: 'recogido',
  acceptedAt: new Date('2026-10-31T10:00:00Z'),
  pickedUpAt: RECOGIDO,
  deliveredAt: null,
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

function logger() {
  return { warn: vi.fn() };
}

describe('sincronizarRutaDeAsignacion', () => {
  it('crea la ruta de una asignación que no la tiene, a nombre de quien escribió', async () => {
    const { tx, escrituras } = txFalsa({
      asignacion: [{ ...FILA, rutaId: null, status: 'asignado', pickedUpAt: null }],
    });
    const log = logger();
    const r = await sincronizarRutaDeAsignacion(tx, {
      asignacionId: 'asig-1',
      origen: 'conductor_asignado',
      userId: 'user-1',
      logger: log as never,
    });

    expect(r).toEqual({ tipo: 'creada', rutaId: 'ruta-nueva', estado: 'planificada' });
    expect(escrituras.find((e) => e.tabla === eventosRuta)?.valores).toEqual({
      rutaId: 'ruta-nueva',
      tipo: 'ruta_creada',
      payload: { viaje_id: 'viaje-1', asignacion_id: 'asig-1', origen: 'conductor_asignado' },
      recordedByUserId: 'user-1',
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('si no puede decidir el estado, iguala el camión, conserva el estado y lo avisa', async () => {
    // Recogida sin conductor: la ruta no pasa a en curso, pero el camión cambió.
    const { tx, escrituras } = txFalsa({ asignacion: [FILA], ruta: [RUTA], paradas: PARADAS });
    const log = logger();
    const r = await sincronizarRutaDeAsignacion(tx, {
      asignacionId: 'asig-1',
      origen: 'recogida_confirmada',
      userId: 'user-1',
      logger: log as never,
    });

    expect(r).toEqual({
      tipo: 'omitida',
      motivo: 'recogida sin conductor: la ruta en curso lo exige',
    });
    expect(escrituras.find((e) => e.tabla === rutas)?.valores).toMatchObject({
      vehicleId: 'veh-2',
      status: 'planificada',
      startedAt: null,
    });
    expect(escrituras.filter((e) => e.tabla === eventosRuta).map((e) => e.valores)).toMatchObject([
      { tipo: 'configuracion_declarada', recordedByUserId: 'user-1' },
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: 'asig-1', origen: 'recogida_confirmada' }),
      expect.any(String),
    );
  });

  it('si no puede decidir el estado y nada más cambió, no escribe', async () => {
    const { tx, escrituras } = txFalsa({
      asignacion: [{ ...FILA, vehicleId: 'veh-1' }],
      ruta: [RUTA],
      paradas: PARADAS,
    });
    const r = await sincronizarRutaDeAsignacion(tx, {
      asignacionId: 'asig-1',
      origen: 'recogida_confirmada',
      userId: 'user-1',
      logger: logger() as never,
    });

    expect(r.tipo).toBe('omitida');
    expect(escrituras).toEqual([]);
  });

  it('una asignación sin ruta y sin los datos de su estado no recibe ruta', async () => {
    const { tx, escrituras } = txFalsa({ asignacion: [{ ...FILA, rutaId: null }] });
    const r = await sincronizarRutaDeAsignacion(tx, {
      asignacionId: 'asig-1',
      origen: 'recogida_confirmada',
      userId: 'user-1',
      logger: logger() as never,
    });

    expect(r.tipo).toBe('omitida');
    expect(escrituras).toEqual([]);
  });

  it('falla si la asignación no existe', async () => {
    const { tx } = txFalsa({ asignacion: [] });
    await expect(
      sincronizarRutaDeAsignacion(tx, {
        asignacionId: 'asig-x',
        origen: 'entrega_confirmada',
        userId: null,
        logger: logger() as never,
      }),
    ).rejects.toThrow(/No existe la asignación/);
  });
});
