import { describe, expect, it, vi } from 'vitest';
import { cambiarGestionFlota, listarTransportistasGestionFlota } from './gestion-flota.js';

const FILA = {
  empresaId: '00000000-0000-4000-8000-0000000000e2',
  razonSocial: 'Fletes Dos SpA',
  rut: '77.000.000-K',
  activadoEn: null,
  activadoPor: null,
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

describe('gestión de flota (ADR-079 §4)', () => {
  it('lista transportistas', async () => {
    const { db } = makeDb([FILA]);
    expect(await listarTransportistasGestionFlota(db)).toEqual([FILA]);
  });

  it('activar registra fecha y autor', async () => {
    const { db, sets } = makeDb([FILA]);
    await cambiarGestionFlota({
      db,
      empresaId: FILA.empresaId,
      activo: true,
      adminEmail: 'a@b.cl',
    });
    expect(sets[0]).toMatchObject({ gestionFlotaActivadaPor: 'a@b.cl' });
    expect((sets[0] as { gestionFlotaActivadaEn: unknown }).gestionFlotaActivadaEn).toBeInstanceOf(
      Date,
    );
  });

  it('desactivar limpia fecha y autor', async () => {
    const { db, sets } = makeDb([FILA]);
    await cambiarGestionFlota({
      db,
      empresaId: FILA.empresaId,
      activo: false,
      adminEmail: 'a@b.cl',
    });
    expect(sets[0]).toEqual({ gestionFlotaActivadaEn: null, gestionFlotaActivadaPor: null });
  });

  it('empresa inexistente o no transportista → null', async () => {
    const { db } = makeDb([]);
    expect(
      await cambiarGestionFlota({
        db,
        empresaId: FILA.empresaId,
        activo: true,
        adminEmail: 'a@b.cl',
      }),
    ).toBeNull();
  });
});
