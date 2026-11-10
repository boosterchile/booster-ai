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

const USUARIO = { id: 'user-1', firebaseUid: 'pending-rut:11111111-1' };

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

describe('cuentaProveedorReutilizable (SC5)', () => {
  it('una cuenta libre se reutiliza', async () => {
    const d = makeDb();
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      cuenta: { uid: 'fb-libre', providerData: [] },
      usuario: USUARIO,
    });
    expect(r).toEqual({ reutilizable: true, uid: 'fb-libre' });
    expect(d.tablas).toEqual(['usuarios', 'solicitudes_registro']);
  });

  it('la cuenta que ya es de la persona se reutiliza aunque tenga proveedores, sin consultar', async () => {
    const d = makeDb({ usuarios: [{ id: 'user-1' }] });
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      cuenta: { uid: 'fb-propia', providerData: [{ providerId: 'password' }] },
      usuario: { id: 'user-1', firebaseUid: 'fb-propia' },
    });
    expect(r).toEqual({ reutilizable: true, uid: 'fb-propia' });
    expect(d.select).not.toHaveBeenCalled();
  });

  it.each([['password'], ['google.com'], ['phone']])(
    'con el proveedor propio %s no se reutiliza, sin consultar',
    async (providerId) => {
      const d = makeDb();
      const r = await cuentaProveedorReutilizable({
        db: d.db,
        cuenta: { uid: 'fb-con-proveedor', providerData: [{ providerId }] },
        usuario: USUARIO,
      });
      expect(r).toEqual({ reutilizable: false, motivo: 'con_proveedor_propio' });
      expect(d.select).not.toHaveBeenCalled();
    },
  );

  it('con el uid de otra fila de usuarios no se reutiliza', async () => {
    const d = makeDb({ usuarios: [{ id: 'user-otro' }] });
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      cuenta: { uid: 'fb-de-otro', providerData: [] },
      usuario: USUARIO,
    });
    expect(r).toEqual({ reutilizable: false, motivo: 'de_otra_cuenta' });
    expect(d.tablas).toEqual(['usuarios']);
  });

  it('con el uid de una solicitud no se reutiliza', async () => {
    const d = makeDb({ solicitudes: [{ id: 'solicitud-1' }] });
    const r = await cuentaProveedorReutilizable({
      db: d.db,
      cuenta: { uid: 'fb-de-solicitud', providerData: [] },
      usuario: USUARIO,
    });
    expect(r).toEqual({ reutilizable: false, motivo: 'de_una_solicitud' });
    expect(d.tablas).toEqual(['usuarios', 'solicitudes_registro']);
  });

  it.each([
    ['sin providerData', { uid: 'fb-x' }],
    ['sin uid', { providerData: [] }],
    ['con uid vacío', { uid: '', providerData: [] }],
    ['con providerData que no es lista', { uid: 'fb-x', providerData: 'password' }],
    ['nula', null],
  ])('una cuenta %s no se reutiliza, sin consultar', async (_caso, cuenta) => {
    const d = makeDb();
    const r = await cuentaProveedorReutilizable({ db: d.db, cuenta, usuario: USUARIO });
    expect(r).toEqual({ reutilizable: false, motivo: 'forma_desconocida' });
    expect(d.select).not.toHaveBeenCalled();
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
