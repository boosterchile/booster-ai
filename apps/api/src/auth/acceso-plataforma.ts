/**
 * Regla única de acceso al panel de Booster (`.specs/acceso-panel-plataforma`).
 *
 * Tiene acceso la cuenta marcada como personal (`es_admin_plataforma = true`)
 * y en estado `activo`, o la cuenta cuyo correo está en la lista de respaldo
 * (`BOOSTER_PLATFORM_ADMIN_EMAILS`). La marca la pone y la quita el panel del
 * personal; la lista de Terraform queda para el primer admin.
 *
 * ADR-028: el «Admin Booster» es la cuenta con `es_admin_plataforma = true`.
 *
 * La usan `requirePlatformAdmin` (todas las rutas `/admin/*`) y `GET /me`
 * (`is_platform_admin`, que decide la web). Ninguna ruta repite la regla.
 * Puro: sin I/O.
 */

export interface CuentaParaAcceso {
  email?: string | null | undefined;
  isPlatformAdmin?: boolean | null | undefined;
  status?: string | null | undefined;
}

function normalizar(email: string): string {
  return email.trim().toLowerCase();
}

/** El correo está en la lista de respaldo, sin distinguir mayúsculas ni espacios. */
export function correoEnListaRespaldo(
  email: string | null | undefined,
  lista: readonly string[],
): boolean {
  if (typeof email !== 'string') {
    return false;
  }
  const buscado = normalizar(email);
  if (buscado.length === 0) {
    return false;
  }
  return lista.some((entrada) => normalizar(entrada) === buscado);
}

export function tieneAccesoPlataforma(cuenta: CuentaParaAcceso, lista: readonly string[]): boolean {
  if (cuenta.isPlatformAdmin === true && cuenta.status === 'activo') {
    return true;
  }
  return correoEnListaRespaldo(cuenta.email, lista);
}

/**
 * Las cuentas del personal se gestionan solo desde Booster (SC7). Un flujo de
 * empresa no toca una cuenta marcada (en cualquier estado) ni una cuyo correo
 * está en la lista de respaldo. Que un flujo no deje un correo de la lista en
 * una cuenta lo decide `correoEnListaRespaldo` sobre el correo nuevo, con la
 * respuesta de un correo ya registrado.
 */
export function cuentaGestionadaPorBooster(opts: {
  cuenta: Pick<CuentaParaAcceso, 'email' | 'isPlatformAdmin'> | null;
  lista: readonly string[];
}): boolean {
  const { cuenta, lista } = opts;
  if (cuenta?.isPlatformAdmin === true) {
    return true;
  }
  return correoEnListaRespaldo(cuenta?.email, lista);
}
