import { describe, expect, it, vi } from 'vitest';
import { assignments, eventosRuta, paradasRuta, rutas } from '../../src/db/schema.js';
import { crearRutaDeAsignacion } from '../../src/services/crear-ruta-de-asignacion.js';

const ASSIGNMENT = {
  id: 'assign-1',
  tripId: 'trip-1',
  empresaId: 'empresa-1',
  vehicleId: 'veh-1',
  unidadArrastreId: 'arrastre-1',
  driverUserId: 'conductor-1',
};

/** Transacción falsa: anota cada escritura con su tabla, en orden. */
function makeTx(rutaRows: { id: string }[] = [{ id: 'ruta-1' }]) {
  const escrituras: { op: string; tabla: unknown; valores: unknown }[] = [];
  const tx = {
    insert: vi.fn((tabla: unknown) => ({
      values: vi.fn((valores: unknown) => {
        escrituras.push({ op: 'insert', tabla, valores });
        return { returning: vi.fn(async () => rutaRows) };
      }),
    })),
    update: vi.fn((tabla: unknown) => ({
      set: vi.fn((valores: unknown) => {
        escrituras.push({ op: 'update', tabla, valores });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  return { tx, escrituras };
}

describe('crearRutaDeAsignacion', () => {
  it('crea la ruta planificada con la empresa, el vehículo, el arrastre y el conductor de la asignación', async () => {
    const { tx, escrituras } = makeTx();
    const r = await crearRutaDeAsignacion(tx as never, {
      assignment: ASSIGNMENT,
      userId: 'user-1',
    });
    expect(r).toEqual({ rutaId: 'ruta-1' });
    expect(escrituras[0]).toEqual({
      op: 'insert',
      tabla: rutas,
      valores: {
        empresaId: 'empresa-1',
        vehicleId: 'veh-1',
        unidadArrastreId: 'arrastre-1',
        driverUserId: 'conductor-1',
        status: 'planificada',
      },
    });
  });

  it('crea la recogida en el orden 0 y la entrega en el 1, del mismo servicio', async () => {
    const { tx, escrituras } = makeTx();
    await crearRutaDeAsignacion(tx as never, { assignment: ASSIGNMENT, userId: 'user-1' });
    expect(escrituras[1]).toEqual({
      op: 'insert',
      tabla: paradasRuta,
      valores: [
        { rutaId: 'ruta-1', orden: 0, tipo: 'recogida', tripId: 'trip-1' },
        { rutaId: 'ruta-1', orden: 1, tipo: 'entrega', tripId: 'trip-1' },
      ],
    });
  });

  it('deja el evento de creación y enlaza la asignación con la ruta', async () => {
    const { tx, escrituras } = makeTx();
    await crearRutaDeAsignacion(tx as never, { assignment: ASSIGNMENT, userId: null });
    expect(escrituras[2]).toEqual({
      op: 'insert',
      tabla: eventosRuta,
      valores: {
        rutaId: 'ruta-1',
        tipo: 'ruta_creada',
        payload: { viaje_id: 'trip-1', asignacion_id: 'assign-1' },
        recordedByUserId: null,
      },
    });
    expect(escrituras[3]).toEqual({
      op: 'update',
      tabla: assignments,
      valores: { rutaId: 'ruta-1' },
    });
    expect(escrituras).toHaveLength(4);
  });

  it('falla sin escribir paradas si el insert de la ruta no devuelve fila', async () => {
    const { tx, escrituras } = makeTx([]);
    await expect(
      crearRutaDeAsignacion(tx as never, { assignment: ASSIGNMENT, userId: 'user-1' }),
    ).rejects.toThrow('Insert ruta returned no row');
    expect(escrituras).toHaveLength(1);
  });
});
