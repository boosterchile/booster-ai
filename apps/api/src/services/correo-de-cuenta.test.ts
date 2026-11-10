import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { correoOcupado, existeCuentaConCorreo } from './correo-de-cuenta.js';

/**
 * T7 de `.specs/correos-solicitudes-panel/spec.md`: el helper que decide si
 * el correo de una cuenta nueva está ocupado (lista de respaldo o cuenta
 * existente, sin distinguir mayúsculas).
 */

const LISTA = ['respaldo@boosterchile.com'];

function makeDb(cuentas: unknown[]) {
  const limit = vi.fn(async (_n: number) => cuentas);
  const where = vi.fn((_predicado: unknown) => ({ limit }));
  const from = vi.fn((_tabla: unknown) => ({ where }));
  const select = vi.fn((_columnas: unknown) => ({ from }));
  return { db: { select } as never, select, where, limit };
}

function consultaDe(predicado: unknown) {
  if (!(predicado instanceof SQL)) {
    throw new Error('la búsqueda no recibió un predicado SQL');
  }
  return new PgDialect().sqlToQuery(predicado);
}

describe('existeCuentaConCorreo', () => {
  it('busca una sola cuenta con lower(email) = lower($1), con el correo normalizado', async () => {
    const d = makeDb([]);

    expect(await existeCuentaConCorreo(d.db, ' Ana.Soto@Empresa.CL ')).toBe(false);

    const consulta = consultaDe(d.where.mock.calls[0]?.[0]);
    expect(consulta.sql).toBe('lower("usuarios"."email") = lower($1)');
    expect(consulta.params).toEqual(['ana.soto@empresa.cl']);
    expect(d.limit).toHaveBeenCalledWith(1);
  });

  it('una fila → hay cuenta', async () => {
    const d = makeDb([{ id: 'cuenta-1' }]);

    expect(await existeCuentaConCorreo(d.db, 'ana.soto@empresa.cl')).toBe(true);
  });
});

describe('correoOcupado', () => {
  it('un correo de la lista, con mayúsculas y espacios, está ocupado y hace la misma consulta que cualquier otro', async () => {
    const d = makeDb([]);

    expect(
      await correoOcupado({ db: d.db, email: ' Respaldo@BoosterChile.com ', lista: LISTA }),
    ).toBe(true);
    expect(d.select).toHaveBeenCalledTimes(1);
    expect(consultaDe(d.where.mock.calls[0]?.[0]).params).toEqual(['respaldo@boosterchile.com']);
  });

  it.each([
    ['el de una cuenta por RUT', 'users+123456785@boosterchile.invalid'],
    [
      'el de un conductor por RUT, con mayúsculas y espacios',
      ' Drivers+123456785@BoosterChile.INVALID ',
    ],
    ['el relleno del alta vieja', 'pending-rut-123456785@empresa.cl'],
  ])('un correo reservado (%s) está ocupado y hace la misma consulta', async (_caso, email) => {
    const d = makeDb([]);

    expect(await correoOcupado({ db: d.db, email, lista: LISTA })).toBe(true);
    expect(d.select).toHaveBeenCalledTimes(1);
  });

  it('fuera de la lista, el correo de una cuenta existente está ocupado', async () => {
    const d = makeDb([{ id: 'cuenta-1' }]);

    expect(await correoOcupado({ db: d.db, email: 'Ana@Empresa.cl', lista: LISTA })).toBe(true);
    expect(consultaDe(d.where.mock.calls[0]?.[0]).params).toEqual(['ana@empresa.cl']);
  });

  it('un correo fuera de la lista y sin cuenta está libre', async () => {
    const d = makeDb([]);

    expect(await correoOcupado({ db: d.db, email: 'ana@empresa.cl', lista: LISTA })).toBe(false);
    expect(d.select).toHaveBeenCalledTimes(1);
  });

  it('con la lista vacía solo cuenta la base', async () => {
    const d = makeDb([]);

    expect(await correoOcupado({ db: d.db, email: 'respaldo@boosterchile.com', lista: [] })).toBe(
      false,
    );
    expect(d.select).toHaveBeenCalledTimes(1);
  });
});
