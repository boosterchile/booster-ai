import { describe, expect, it, vi } from 'vitest';
import { rutaCompartidaDelViaje } from '../../src/services/ruta-compartida.js';

function makeDb(selects: unknown[][]) {
  const cola = [...selects];
  return {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => cola.shift() ?? []),
      };
      return chain;
    }),
  } as never;
}

describe('rutaCompartidaDelViaje', () => {
  it('un viaje sin asignación o sin ruta va solo', async () => {
    expect(await rutaCompartidaDelViaje(makeDb([[]]), 'v')).toBeNull();
    expect(await rutaCompartidaDelViaje(makeDb([[{ rutaId: null }]]), 'v')).toBeNull();
  });

  it('una ruta con un solo servicio no es compartida', async () => {
    const db = makeDb([[{ rutaId: 'r' }], [{ id: 'a1' }]]);
    expect(await rutaCompartidaDelViaje(db, 'v')).toBeNull();
  });

  it('una ruta con dos servicios es compartida, y dice si ya cerró', async () => {
    const dos = [{ id: 'a1' }, { id: 'a2' }];
    expect(
      await rutaCompartidaDelViaje(makeDb([[{ rutaId: 'r' }], dos, [{ status: 'en_curso' }]]), 'v'),
    ).toEqual({ rutaId: 'r', cerrada: false });
    expect(
      await rutaCompartidaDelViaje(makeDb([[{ rutaId: 'r' }], dos, [{ status: 'cerrada' }]]), 'v'),
    ).toEqual({ rutaId: 'r', cerrada: true });
    expect(await rutaCompartidaDelViaje(makeDb([[{ rutaId: 'r' }], dos, []]), 'v')).toEqual({
      rutaId: 'r',
      cerrada: false,
    });
  });
});
