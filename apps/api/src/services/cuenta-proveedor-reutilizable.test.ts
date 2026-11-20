import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import {
  cuentaCreadaPorSolicitud,
  cuentaProveedorReutilizable,
} from './cuenta-proveedor-reutilizable.js';

/**
 * `.specs/correos-solicitudes-panel` SC5 y SC6. La consulta real contra
 * Postgres vive en
 * `test/integration/cuentas-proveedor-aprobacion.integration.test.ts`.
 */

const USUARIO_ID = 'user-1';

/** Doble de `db.select` que responde según la tabla y anota cada consulta. */
function makeDb(filas: { usuarios?: unknown[]; solicitudes?: unknown[] } = {}) {
  const tablas: string[] = [];
  const select = vi.fn(() => ({
    from: vi.fn((tabla: Parameters<typeof getTableName>[0]) => {
      const nombre = getTableName(tabla);
      tablas.push(nombre);
      const resultado = nombre === 'solicitudes_registro' ? filas.solicitudes : filas.usuarios;
      return {
        where: vi.fn(() => ({ limit: vi.fn(async () => resultado ?? []) })),
      };
    }),
  }));
  return { db: { select } as unknown as Db, select, tablas };
}

function makeAuth(opts: { revocarFalla?: boolean } = {}) {
  const revokeRefreshTokens = vi.fn(async (_uid: string) => {
    if (opts.revocarFalla) {
      throw Object.assign(new Error('quota'), { code: 'auth/internal-error' });
    }
  });
  return { auth: { revokeRefreshTokens }, revokeRefreshTokens };
}

describe('cuentaProveedorReutilizable (SC5)', () => {
  it('una cuenta libre se reutiliza y antes se revocan sus sesiones', async () => {
    const d = makeDb();
    const a = makeAuth();
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      auth: a.auth,
      cuenta: { uid: 'fb-libre', providerData: [] },
      usuarioId: USUARIO_ID,
    });
    expect(r).toEqual({ reutilizable: true, uid: 'fb-libre' });
    expect(d.tablas).toEqual(['usuarios', 'solicitudes_registro']);
    expect(a.revokeRefreshTokens).toHaveBeenCalledWith('fb-libre');
  });

  it('la cuenta cuyo uid ya es el de la fila que se activa se reutiliza aunque tenga proveedores, sin revocar', async () => {
    const d = makeDb({ usuarios: [{ id: USUARIO_ID }] });
    const a = makeAuth();
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      auth: a.auth,
      cuenta: { uid: 'fb-propia', providerData: [{ providerId: 'password' }] },
      usuarioId: USUARIO_ID,
    });
    expect(r).toEqual({ reutilizable: true, uid: 'fb-propia' });
    expect(d.tablas).toEqual(['usuarios']);
    expect(a.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it.each([['password'], ['google.com'], ['phone']])(
    'con el proveedor propio %s no se reutiliza ni se revoca',
    async (providerId) => {
      const d = makeDb();
      const a = makeAuth();
      const r = await cuentaProveedorReutilizable({
        db: d.db,
        auth: a.auth,
        cuenta: { uid: 'fb-con-proveedor', providerData: [{ providerId }] },
        usuarioId: USUARIO_ID,
      });
      expect(r).toEqual({ reutilizable: false, motivo: 'con_proveedor_propio' });
      expect(d.tablas).toEqual(['usuarios']);
      expect(a.revokeRefreshTokens).not.toHaveBeenCalled();
    },
  );

  it('con el uid de otra fila de usuarios no se reutiliza ni se revoca', async () => {
    const d = makeDb({ usuarios: [{ id: 'user-otro' }] });
    const a = makeAuth();
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      auth: a.auth,
      cuenta: { uid: 'fb-de-otro', providerData: [] },
      usuarioId: USUARIO_ID,
    });
    expect(r).toEqual({ reutilizable: false, motivo: 'de_otra_cuenta' });
    expect(d.tablas).toEqual(['usuarios']);
    expect(a.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('con el uid de una solicitud no se reutiliza ni se revoca', async () => {
    const d = makeDb({ solicitudes: [{ id: 'solicitud-1' }] });
    const a = makeAuth();
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      auth: a.auth,
      cuenta: { uid: 'fb-de-solicitud', providerData: [] },
      usuarioId: USUARIO_ID,
    });
    expect(r).toEqual({ reutilizable: false, motivo: 'de_una_solicitud' });
    expect(d.tablas).toEqual(['usuarios', 'solicitudes_registro']);
    expect(a.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('si revocar las sesiones falla, el error sube y la cuenta no se entrega', async () => {
    const d = makeDb();
    const a = makeAuth({ revocarFalla: true });
    await expect(
      cuentaProveedorReutilizable({
        db: d.db,
        auth: a.auth,
        cuenta: { uid: 'fb-libre', providerData: [] },
        usuarioId: USUARIO_ID,
      }),
    ).rejects.toThrow('quota');
  });

  it.each([
    ['sin providerData', { uid: 'fb-x' }],
    ['sin uid', { providerData: [] }],
    ['con uid vacío', { uid: '', providerData: [] }],
    ['con providerData que no es lista', { uid: 'fb-x', providerData: 'password' }],
    ['nula', null],
  ])('una cuenta %s no se reutiliza, sin consultar ni revocar', async (_caso, cuenta) => {
    const d = makeDb();
    const a = makeAuth();
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      auth: a.auth,
      cuenta,
      usuarioId: USUARIO_ID,
    });
    expect(r).toEqual({ reutilizable: false, motivo: 'forma_desconocida' });
    expect(d.select).not.toHaveBeenCalled();
    expect(a.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});

describe('cuentaCreadaPorSolicitud (SC6)', () => {
  it('el uid de una solicitud → true', async () => {
    const d = makeDb({ solicitudes: [{ id: 'solicitud-1' }] });
    await expect(cuentaCreadaPorSolicitud(d.db, 'fb-de-solicitud')).resolves.toBe(true);
    expect(d.tablas).toEqual(['solicitudes_registro']);
  });

  it('un uid que no está en ninguna solicitud → false', async () => {
    const d = makeDb();
    await expect(cuentaCreadaPorSolicitud(d.db, 'fb-otro')).resolves.toBe(false);
  });
});
