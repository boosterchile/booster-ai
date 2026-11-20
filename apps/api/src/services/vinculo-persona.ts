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

/**
 * Lo que recibe quien da de alta a una persona que ya existe. Es el mismo valor
 * para cualquier estado de la cuenta: un tercero no debe poder distinguirlo.
 */
export const VINCULO_PERSONA_EXISTENTE = 'codigo_vigente' satisfies VinculoPersona;

/** `12.345.678-5` → `*****678-5`. Para mostrar o loguear sin exponer el RUT. */
export function mascarRut(rut: string | null): string | null {
  if (!rut) {
    return rut;
  }
  return rut.replace(/^[\d.]+(?=\d{3}-)/, (m) => '*'.repeat(m.replace(/\./g, '').length));
}

/** `persona@dominio.cl` → `p***@dominio.cl`. */
export function mascarEmail(email: string | null): string | null {
  if (!email) {
    return email;
  }
  const at = email.indexOf('@');
  return at <= 0 ? '***' : `${email[0]}***${email.slice(at)}`;
}

/**
 * La persona ya existía cuando esta empresa la sumó (con tolerancia para el alta que
 * crea a la persona y su vínculo en la misma operación). Sin fechas, se
 * asume que sí: nunca se entrega acceso por falta de datos.
 */
export function personaPrevia(
  personaCreadaEn: Date | null | undefined,
  vinculoCreadoEn: Date | null | undefined,
): boolean {
  if (!personaCreadaEn || !vinculoCreadoEn) {
    return true;
  }
  return new Date(personaCreadaEn).getTime() < new Date(vinculoCreadoEn).getTime() - 60_000;
}

/** `/auth/activar` no reescribe una cuenta que ya salió del placeholder. */
export function cuentaYaActivada(persona: {
  firebaseUid: string;
  claveNumericaHash: string | null;
}): boolean {
  return clasificarVinculoPersona({ ...persona, activationPinHash: null }) === 'cuenta_activa';
}

/**
 * Código del panel del personal de Booster (`.specs/alta-personal-booster`).
 *
 * `activacion_vence_en` no nulo significa que el `activacion_pin_hash` actual
 * lo emitió el panel (alta o re-emisión). Cualquier otro emisor que reescribe
 * el hash de una cuenta existente deja `activacion_vence_en` en NULL en el
 * mismo UPDATE. Vigente: el vencimiento existe y no pasó.
 */
export function codigoPersonalVigente(venceEn: Date | string | null, ahora = Date.now()): boolean {
  if (venceEn === null) {
    return false;
  }
  return new Date(venceEn).getTime() >= ahora;
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
