import { describe, expect, it, vi } from 'vitest';
import {
  cambiarOfertasCarga,
  listarTransportistasOfertasCarga,
} from './ofertas-carga-por-empresa.js';

const FILA = {
  empresaId: '00000000-0000-4000-8000-0000000000e3',
  razonSocial: 'Flota Sola SpA',
  rut: '77.000.001-K',
  activo: true,
  cambiadoEn: null,
  cambiadoPor: null,
};

function makeDb(filas: unknown[]) {
  const sets: unknown[] = [];
  const db = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => filas,
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: (v: unknown) => {
        sets.push(v);
        return { where: () => ({ returning: async () => filas }) };
      },
    })),
  };
  return { db: db as never, sets };
}

describe('ofertas de carga por empresa (servicios-por-empresa)', () => {
  it('lista transportistas', async () => {
    const { db } = makeDb([FILA]);
    expect(await listarTransportistasOfertasCarga(db)).toEqual([FILA]);
  });

  it.each([false, true])('cambiar a %s registra el valor, la fecha y el autor', async (activo) => {
    const { db, sets } = makeDb([{ ...FILA, activo }]);
    const fila = await cambiarOfertasCarga({
      db,
      empresaId: FILA.empresaId,
      activo,
      adminEmail: 'a@b.cl',
    });
    expect(fila).toMatchObject({ activo });
    expect(sets[0]).toMatchObject({
      recibeOfertasCarga: activo,
      recibeOfertasCargaCambiadoPor: 'a@b.cl',
    });
    expect(
      (sets[0] as { recibeOfertasCargaCambiadoEn: unknown }).recibeOfertasCargaCambiadoEn,
    ).toBeInstanceOf(Date);
  });

  it('devuelve null si la empresa no existe o no es transportista', async () => {
    const { db } = makeDb([]);
    expect(
      await cambiarOfertasCarga({ db, empresaId: FILA.empresaId, activo: false, adminEmail: 'a' }),
    ).toBeNull();
  });
});
