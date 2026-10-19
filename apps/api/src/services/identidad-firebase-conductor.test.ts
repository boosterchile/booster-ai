import { describe, expect, it, vi } from 'vitest';
import {
  type IdentidadFirebaseAuth,
  IdentidadFirebaseEnConflicto,
  type UsuarioFirebaseConductor,
  candidatosEmailRelleno,
  reconciliarIdentidadFirebaseConductor,
} from './identidad-firebase-conductor.js';

const SINTETICO = 'drivers+111111111@boosterchile.invalid';
const RELLENO = 'pending-rut-111111111@boosterchile.invalid';
const RUT = '11.111.111-1';

function usuario(uid: string, email: string, lastSignInTime?: string): UsuarioFirebaseConductor {
  return {
    uid,
    email,
    metadata: lastSignInTime ? { lastSignInTime } : {},
  };
}

function authCon(cuentas: Record<string, UsuarioFirebaseConductor>): {
  auth: IdentidadFirebaseAuth;
  updateUser: ReturnType<typeof vi.fn>;
  deleteUser: ReturnType<typeof vi.fn>;
} {
  const updateUser = vi.fn(async () => undefined);
  const deleteUser = vi.fn(async () => undefined);
  const auth: IdentidadFirebaseAuth = {
    getUserByEmail: async (email: string) => {
      const encontrado = cuentas[email.toLowerCase()];
      if (!encontrado) {
        throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      }
      return encontrado;
    },
    updateUser,
    deleteUser,
  };
  return { auth, updateUser, deleteUser };
}

describe('candidatosEmailRelleno', () => {
  it('incluye el email guardado y el canónico del RUT, sin repetir', () => {
    expect(candidatosEmailRelleno(RELLENO, RUT)).toEqual([RELLENO]);
    expect(candidatosEmailRelleno('pending-rut-11.111.111-1@boosterchile.invalid', RUT)).toEqual([
      'pending-rut-11.111.111-1@boosterchile.invalid',
      RELLENO,
    ]);
  });

  it('un email real no es candidato de relleno', () => {
    expect(candidatosEmailRelleno('usuario@example.com', null)).toEqual([]);
  });
});

describe('reconciliarIdentidadFirebaseConductor', () => {
  it('cuenta activa: no consulta Firebase', async () => {
    const getUserByEmail = vi.fn();
    const auth = { getUserByEmail, updateUser: vi.fn(), deleteUser: vi.fn() };
    const accion = await reconciliarIdentidadFirebaseConductor({
      auth,
      cuentaActiva: true,
      emailAnterior: RELLENO,
      rut: RUT,
      syntheticEmail: SINTETICO,
    });
    expect(accion).toBe('omitida_cuenta_activa');
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('sin cliente Firebase y cuenta pendiente: no inventa un uid', async () => {
    const accion = await reconciliarIdentidadFirebaseConductor({
      auth: null,
      cuentaActiva: false,
      emailAnterior: RELLENO,
      rut: RUT,
      syntheticEmail: SINTETICO,
    });
    expect(accion).toBe('firebase_no_disponible');
  });

  it('sin cuenta en Auth: no crea una nueva', async () => {
    const { auth, updateUser, deleteUser } = authCon({});
    const accion = await reconciliarIdentidadFirebaseConductor({
      auth,
      cuentaActiva: false,
      emailAnterior: RELLENO,
      rut: RUT,
      syntheticEmail: SINTETICO,
    });
    expect(accion).toBe('sin_cuenta_firebase');
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('el uid creado con el relleno pasa al sintético que ya usa driver-activate', async () => {
    const { auth, updateUser, deleteUser } = authCon({
      [RELLENO]: usuario('uid-fixture', RELLENO),
    });
    const accion = await reconciliarIdentidadFirebaseConductor({
      auth,
      cuentaActiva: false,
      emailAnterior: RELLENO,
      rut: RUT,
      syntheticEmail: SINTETICO,
    });
    expect(accion).toBe('alineada_a_sintetico');
    expect(updateUser).toHaveBeenCalledWith('uid-fixture', {
      email: SINTETICO,
      emailVerified: false,
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('si el sintético ya es esa misma cuenta, no la reescribe', async () => {
    const { auth, updateUser } = authCon({
      [SINTETICO]: usuario('uid-fixture', SINTETICO),
    });
    const accion = await reconciliarIdentidadFirebaseConductor({
      auth,
      cuentaActiva: false,
      emailAnterior: RELLENO,
      rut: RUT,
      syntheticEmail: SINTETICO,
    });
    expect(accion).toBe('ya_alineada');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('borra el relleno que nunca entró y se queda con el sintético', async () => {
    const { auth, updateUser, deleteUser } = authCon({
      [SINTETICO]: usuario('uid-sintetico', SINTETICO),
      [RELLENO]: usuario('uid-relleno', RELLENO),
    });
    const accion = await reconciliarIdentidadFirebaseConductor({
      auth,
      cuentaActiva: false,
      emailAnterior: RELLENO,
      rut: RUT,
      syntheticEmail: SINTETICO,
    });
    expect(accion).toBe('huerfano_relleno_eliminado');
    expect(deleteUser).toHaveBeenCalledWith('uid-relleno');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('dos cuentas que ya iniciaron sesión: conflicto, sin borrar ni reescribir', async () => {
    const { auth, updateUser, deleteUser } = authCon({
      [SINTETICO]: usuario('uid-sintetico', SINTETICO, 'Mon, 19 Oct 2026 12:00:00 GMT'),
      [RELLENO]: usuario('uid-relleno', RELLENO, 'Mon, 19 Oct 2026 13:00:00 GMT'),
    });
    await expect(
      reconciliarIdentidadFirebaseConductor({
        auth,
        cuentaActiva: false,
        emailAnterior: RELLENO,
        rut: RUT,
        syntheticEmail: SINTETICO,
      }),
    ).rejects.toBeInstanceOf(IdentidadFirebaseEnConflicto);
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
