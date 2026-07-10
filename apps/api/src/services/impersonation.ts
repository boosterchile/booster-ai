/**
 * Lógica pura de autorización de impersonación (target-side) — impersonación
 * auditada. El caller-side (feature flag + auth + allowlist platform-admin) lo
 * resuelve `requirePlatformAdmin` en la ruta; acá decidimos si, dado un admin
 * válido, el TARGET es impersonable.
 *
 * Sin efectos: recibe el target ya resuelto de la DB y devuelve una decisión
 * como tagged union, testeable en aislamiento (trust boundary).
 */

const PENDING_FIREBASE_UID_PREFIX = 'pending-rut:';

export interface ImpersonationTarget {
  id: string;
  firebaseUid: string;
  isPlatformAdmin: boolean;
}

export type EvaluateImpersonationResult =
  | { ok: true; targetUserId: string; targetFirebaseUid: string }
  | { ok: false; status: 400 | 403 | 404 | 409; code: string };

export function evaluateImpersonationTarget(opts: {
  callerUserId: string;
  target: ImpersonationTarget | null;
}): EvaluateImpersonationResult {
  const { callerUserId, target } = opts;

  if (!target) {
    return { ok: false, status: 404, code: 'target_not_found' };
  }

  // No admin→admin: un admin nunca puede impersonar a otro platform-admin
  // (ni a sí mismo, que también es admin). Se chequea ANTES que self para no
  // filtrar estado de activación de cuentas admin.
  if (target.isPlatformAdmin) {
    return { ok: false, status: 403, code: 'forbidden_impersonate_admin' };
  }

  if (target.id === callerUserId) {
    return { ok: false, status: 400, code: 'cannot_impersonate_self' };
  }

  // El target debe tener un Firebase user real para poder mintear un custom
  // token. Los placeholders `pending-rut:<rut>` (conductores que nunca
  // activaron su clave) no tienen UID real.
  if (target.firebaseUid.startsWith(PENDING_FIREBASE_UID_PREFIX)) {
    return { ok: false, status: 409, code: 'target_not_activated' };
  }

  return { ok: true, targetUserId: target.id, targetFirebaseUid: target.firebaseUid };
}
