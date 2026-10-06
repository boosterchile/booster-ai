/**
 * Vincular una persona que ya existe, sin tomar su cuenta.
 *
 * Una persona puede tener membresías en varias empresas (ADR-028). El alta
 * reusa la fila de `usuarios`. No reescribe `activacion_pin_hash` ni
 * `clave_numerica_hash`: un código entregado por otra empresa no es una
 * credencial nueva.
 */

export const PENDING_FIREBASE_UID_PREFIX = 'pending-rut:';

/** 7 días, la misma ventana que `/auth/activar` y el alta de miembros. */
export const CODIGO_ACTIVACION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type VinculoPersona = 'nueva' | 'cuenta_activa' | 'codigo_vigente' | 'provisoria_sin_codigo';

export interface PersonaParaVinculo {
  firebaseUid: string;
  claveNumericaHash: string | null;
  activationPinHash: string | null;
}

/**
 * Cuenta viva: ya eligió clave, o su `firebase_uid` ya no es el placeholder.
 * En ese caso no se emite código y la membresía nace activa.
 *
 * Provisoria con hash de código: el código vigente se conserva.
 * Provisoria sin hash: se puede emitir el primero.
 */
function tieneSecreto(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

export function clasificarVinculoPersona(
  persona: PersonaParaVinculo,
): Exclude<VinculoPersona, 'nueva'> {
  const uid = persona.firebaseUid ?? '';
  const cuentaViva =
    tieneSecreto(persona.claveNumericaHash) ||
    uid.length === 0 ||
    !uid.startsWith(PENDING_FIREBASE_UID_PREFIX);
  if (cuentaViva) {
    return 'cuenta_activa';
  }
  if (tieneSecreto(persona.activationPinHash)) {
    return 'codigo_vigente';
  }
  return 'provisoria_sin_codigo';
}

/** `/auth/activar` no reescribe una cuenta que ya salió del placeholder. */
export function cuentaYaActivada(persona: {
  firebaseUid: string;
  claveNumericaHash: string | null;
}): boolean {
  return clasificarVinculoPersona({ ...persona, activationPinHash: null }) === 'cuenta_activa';
}

export function invitacionesVigentes<T extends { invitedAt: Date | string }>(
  rows: readonly T[],
  now = Date.now(),
): T[] {
  return rows.filter((row) => {
    const invited = new Date(row.invitedAt).getTime();
    return invited + CODIGO_ACTIVACION_TTL_MS >= now;
  });
}
