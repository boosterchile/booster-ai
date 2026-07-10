import { describe, expect, it } from 'vitest';
import { evaluateImpersonationTarget } from './impersonation.js';

/**
 * Trust boundary de la impersonación (parte target-side).
 *
 * El caller-side (feature flag + auth presente + allowlist platform-admin) lo
 * resuelve `requirePlatformAdmin` en la ruta (patrón ya testeado). Esta función
 * pura decide, dado un admin válido, si el TARGET es impersonable:
 *
 *   - target inexistente → 404 target_not_found.
 *   - target es platform-admin → 403 forbidden_impersonate_admin (sin admin→admin).
 *   - target == caller → 400 cannot_impersonate_self.
 *   - target sin Firebase UID real (placeholder `pending-rut:`) → 409
 *     target_not_activated (no se puede mintear custom token).
 *   - resto → ok con targetFirebaseUid + targetUserId.
 */

const CALLER = 'admin-uuid';

function target(overrides: Partial<{ id: string; firebaseUid: string; isPlatformAdmin: boolean }>) {
  return {
    id: 'target-uuid',
    firebaseUid: 'firebase-real-uid',
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('evaluateImpersonationTarget', () => {
  it('target inexistente → 404 target_not_found', () => {
    const r = evaluateImpersonationTarget({ callerUserId: CALLER, target: null });
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('unreachable');
    }
    expect(r.status).toBe(404);
    expect(r.code).toBe('target_not_found');
  });

  it('target es platform-admin → 403 forbidden_impersonate_admin (sin admin→admin)', () => {
    const r = evaluateImpersonationTarget({
      callerUserId: CALLER,
      target: target({ isPlatformAdmin: true }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('unreachable');
    }
    expect(r.status).toBe(403);
    expect(r.code).toBe('forbidden_impersonate_admin');
  });

  it('target == caller → 400 cannot_impersonate_self', () => {
    const r = evaluateImpersonationTarget({
      callerUserId: CALLER,
      target: target({ id: CALLER }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('unreachable');
    }
    expect(r.status).toBe(400);
    expect(r.code).toBe('cannot_impersonate_self');
  });

  it('target con firebase_uid placeholder pending-rut: → 409 target_not_activated', () => {
    const r = evaluateImpersonationTarget({
      callerUserId: CALLER,
      target: target({ firebaseUid: 'pending-rut:12345678-9' }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('unreachable');
    }
    expect(r.status).toBe(409);
    expect(r.code).toBe('target_not_activated');
  });

  it('target válido no-admin, distinto del caller, activado → ok', () => {
    const r = evaluateImpersonationTarget({
      callerUserId: CALLER,
      target: target({ id: 'other-uuid', firebaseUid: 'fb-real', isPlatformAdmin: false }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error('unreachable');
    }
    expect(r.targetUserId).toBe('other-uuid');
    expect(r.targetFirebaseUid).toBe('fb-real');
  });

  it('admin tiene prioridad sobre self (caller-admin apuntándose a sí mismo → forbidden_impersonate_admin)', () => {
    const r = evaluateImpersonationTarget({
      callerUserId: CALLER,
      target: target({ id: CALLER, isPlatformAdmin: true }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('unreachable');
    }
    expect(r.code).toBe('forbidden_impersonate_admin');
  });
});
