import { esEmailDeRelleno } from '@booster-ai/shared-schemas';

/**
 * Identidad Firebase de un conductor pendiente.
 *
 * El login no usa el email real: `driver-activate` busca o crea
 * `drivers+<rut>@boosterchile.invalid` y después `login-rut` emite un custom
 * token para ese uid. Si el alta vieja creó la cuenta de Auth con el relleno
 * `pending-rut-…@boosterchile.invalid`, hay que mover ESA cuenta al sintético.
 * Crear otra duplicaría el uid y el próximo activate no la encontraría.
 *
 * Una cuenta ya activada no se toca: su uid guardado es el del custom token.
 */

export type AccionFirebaseConductor =
  | 'omitida_cuenta_activa'
  | 'sin_cuenta_firebase'
  | 'alineada_a_sintetico'
  | 'ya_alineada'
  | 'huerfano_relleno_eliminado'
  | 'firebase_no_disponible';

export class IdentidadFirebaseEnConflicto extends Error {
  readonly code = 'identidad_firebase_en_conflicto' as const;

  constructor() {
    super('identidad_firebase_en_conflicto');
    this.name = 'IdentidadFirebaseEnConflicto';
  }
}

export interface UsuarioFirebaseConductor {
  uid: string;
  email?: string;
  metadata: { lastSignInTime?: string };
}

export interface IdentidadFirebaseAuth {
  getUserByEmail(email: string): Promise<UsuarioFirebaseConductor>;
  updateUser(uid: string, properties: { email: string; emailVerified: boolean }): Promise<unknown>;
  deleteUser(uid: string): Promise<void>;
}

function codigoError(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

function entroAlgunaVez(usuario: UsuarioFirebaseConductor): boolean {
  const ingreso = usuario.metadata.lastSignInTime;
  return typeof ingreso === 'string' && ingreso.length > 0;
}

/**
 * Correos de relleno que pudieron quedar como email de Auth para este RUT.
 * El de la fila y el canónico `pending-rut-<rutSinSeparadores>@…`.
 */
export function candidatosEmailRelleno(emailAnterior: string, rut: string | null): string[] {
  const vistos = new Set<string>();
  const agregar = (email: string) => {
    const normal = email.trim().toLowerCase();
    if (normal.length > 0 && esEmailDeRelleno(normal)) {
      vistos.add(normal);
    }
  };
  agregar(emailAnterior);
  if (rut) {
    const compacto = rut.replace(/[.\-\s]/g, '');
    agregar(`pending-rut-${compacto}@boosterchile.invalid`);
  }
  return [...vistos];
}

async function buscarUsuario(
  auth: IdentidadFirebaseAuth,
  email: string,
): Promise<UsuarioFirebaseConductor | null> {
  try {
    return await auth.getUserByEmail(email);
  } catch (err) {
    if (codigoError(err) === 'auth/user-not-found') {
      return null;
    }
    throw err;
  }
}

export async function reconciliarIdentidadFirebaseConductor(opts: {
  auth: IdentidadFirebaseAuth | null;
  cuentaActiva: boolean;
  emailAnterior: string;
  rut: string | null;
  syntheticEmail: string;
}): Promise<AccionFirebaseConductor> {
  if (opts.cuentaActiva) {
    return 'omitida_cuenta_activa';
  }
  if (!opts.auth) {
    return 'firebase_no_disponible';
  }

  const sintetico = opts.syntheticEmail.trim().toLowerCase();
  const porUid = new Map<string, UsuarioFirebaseConductor>();
  const recordar = (usuario: UsuarioFirebaseConductor | null) => {
    if (usuario) {
      porUid.set(usuario.uid, usuario);
    }
  };

  recordar(await buscarUsuario(opts.auth, sintetico));
  for (const candidato of candidatosEmailRelleno(opts.emailAnterior, opts.rut)) {
    if (candidato === sintetico) {
      continue;
    }
    recordar(await buscarUsuario(opts.auth, candidato));
  }

  const cuentas = [...porUid.values()];
  if (cuentas.length === 0) {
    return 'sin_cuenta_firebase';
  }

  const conIngreso = cuentas.filter(entroAlgunaVez);
  if (conIngreso.length > 1) {
    throw new IdentidadFirebaseEnConflicto();
  }

  const keeper =
    conIngreso[0] ??
    cuentas.find((cuenta) => (cuenta.email ?? '').toLowerCase() === sintetico) ??
    cuentas[0];
  if (!keeper) {
    return 'sin_cuenta_firebase';
  }

  const huerfanos = cuentas.filter((cuenta) => cuenta.uid !== keeper.uid);
  for (const huerfano of huerfanos) {
    if (entroAlgunaVez(huerfano)) {
      throw new IdentidadFirebaseEnConflicto();
    }
    await opts.auth.deleteUser(huerfano.uid);
  }

  const emailKeeper = (keeper.email ?? '').toLowerCase();
  if (emailKeeper !== sintetico) {
    try {
      await opts.auth.updateUser(keeper.uid, { email: sintetico, emailVerified: false });
    } catch (err) {
      if (codigoError(err) === 'auth/email-already-exists') {
        throw new IdentidadFirebaseEnConflicto();
      }
      throw err;
    }
    return huerfanos.length > 0 ? 'huerfano_relleno_eliminado' : 'alineada_a_sintetico';
  }

  return huerfanos.length > 0 ? 'huerfano_relleno_eliminado' : 'ya_alineada';
}
