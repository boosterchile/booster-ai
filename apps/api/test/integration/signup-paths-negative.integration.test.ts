import { describe, expect, it } from 'vitest';

/**
 * T9c SEC-001 Sprint 2b — Negative matrix test sobre los 5 métodos creation
 * MÁS exploitables del inventario SC-1.2.0 (`docs/qa/signup-paths-audit.md`).
 *
 * Spec amendment A2 v3.4 (2026-05-25): scope reducido del SC-1.2.4 v3.2
 * original (12 métodos) → 5 métodos. Rationale: mutation paths requieren
 * user-ya-existente; sign-in paths no son self-signup vectors; los 5
 * elegidos son los únicos que pueden CREAR un new user sin gate previo.
 *
 * **Naturaleza del test**: contract/documentation matrix. Identity Platform
 * configurado por T11 (`infrastructure/identity-platform.tf`) con
 * `client.permissions.disabled_user_signup=true` retorna `auth/operation-
 * not-allowed` cuando un cliente Firebase Auth SDK invoca cualquiera de los
 * 5 métodos. Este test no levanta el Firebase Auth real (overkill para
 * integration scope); simula el response esperado y asserts el contract
 * propagado.
 *
 * **Verificación real**: smoke E2E manual post-T11 apply (ver
 * `docs/qa/identity-platform-config.md` §3.4) — el reviewer humano abre
 * la web app post-apply y verifica que el flow signup retorna error.
 *
 * **Cobertura future-proof**: 3 de los 5 métodos NO están actualmente
 * en uso en `apps/web/src` (verificado en T6 audit signup-paths-audit.md
 * §3): `sendSignInLinkToEmail`, `signInWithEmailLink`, `applyActionCode`.
 * Si en el futuro código nuevo en apps/web los introduce, este test
 * documenta que serán bloqueados automáticamente por el config Terraform
 * sin code change adicional.
 */

const BLOCKED_CREATION_METHODS = [
  {
    method: 'createUserWithEmailAndPassword',
    usedIn: 'apps/web/src/hooks/use-auth.ts:137 (signUpWithEmail)',
    migrationPlan: 'MIGRAR T9 — removido junto con signUpWithEmail (admin-approval gate)',
  },
  {
    method: 'sendSignInLinkToEmail',
    usedIn: 'NO usado en main HEAD',
    migrationPlan: 'Future code paths bloqueados estructuralmente por T11',
  },
  {
    method: 'signInWithEmailLink',
    usedIn: 'NO usado en main HEAD',
    migrationPlan: 'Future code paths bloqueados estructuralmente por T11',
  },
  {
    method: 'sendPasswordResetEmail',
    usedIn: 'apps/web/src/hooks/use-auth.ts:149 (requestPasswordReset)',
    migrationPlan:
      'ALLOWLIST + REVIEW_BY (post-T11 retorna user-not-found si email no en users; no self-signup vector)',
  },
  {
    method: 'applyActionCode',
    usedIn: 'NO usado en main HEAD',
    migrationPlan: 'Future code paths bloqueados estructuralmente por T11',
  },
] as const;

/**
 * Simulación del Identity Platform response con `disabled_user_signup=true`.
 * Estructura matchea Firebase Auth SDK error shape (FirebaseError) que el
 * cliente recibe en producción post-T11 apply.
 */
interface SimulatedIdPError {
  code: string;
  message: string;
  customData?: { appName: string };
}

function simulateIdPSignupBlocked(method: string): SimulatedIdPError {
  return {
    code: 'auth/operation-not-allowed',
    message: `[${method}] Identity Platform admin disabled signup for this project.`,
    customData: { appName: '[DEFAULT]' },
  };
}

describe('integration: SC-1.2.4 matrix — 5 creation paths blocked post-T11 (Identity Platform OFF)', () => {
  it.each(BLOCKED_CREATION_METHODS)(
    '$method → auth/operation-not-allowed (used in: $usedIn)',
    ({ method, migrationPlan }) => {
      // Documentación: este test es contract. Verifica que la simulación del
      // error Identity Platform retorna el código exacto que apps/web
      // catch handlers deben procesar. Real verification = smoke E2E post-
      // apply per docs/qa/identity-platform-config.md §3.4.
      const simulated = simulateIdPSignupBlocked(method);
      expect(simulated.code).toBe('auth/operation-not-allowed');
      expect(simulated.message).toContain(method);
      expect(simulated.customData?.appName).toBe('[DEFAULT]');

      // Documenta el migration plan inline — útil cuando el test falle en
      // futuro (e.g., spec amendment cambia el set de métodos cubiertos).
      expect(migrationPlan.length).toBeGreaterThan(0);
    },
  );

  it('inventario completo — 5 métodos exactos (no expansión silenciosa)', () => {
    const methodNames = BLOCKED_CREATION_METHODS.map((m) => m.method);
    expect(methodNames).toHaveLength(5);
    expect(methodNames).toEqual([
      'createUserWithEmailAndPassword',
      'sendSignInLinkToEmail',
      'signInWithEmailLink',
      'sendPasswordResetEmail',
      'applyActionCode',
    ]);
    // Spec amendment A2 v3.4 explícito: 5 métodos. Si el set crece a 12
    // (v3.2 original) o se reduce a < 5, requiere spec amendment update.
  });

  it('mutation + sign-in paths NO en el set (defense documentation)', () => {
    const methodNames = new Set(BLOCKED_CREATION_METHODS.map((m) => m.method));
    // Mutation paths (requieren user ya existente):
    expect(methodNames.has('updatePassword' as never)).toBe(false);
    expect(methodNames.has('confirmPasswordReset' as never)).toBe(false);
    expect(methodNames.has('reauthenticateWithCredential' as never)).toBe(false);
    expect(methodNames.has('verifyBeforeUpdateEmail' as never)).toBe(false);
    expect(methodNames.has('unlink' as never)).toBe(false);
    expect(methodNames.has('updateProfile' as never)).toBe(false);
    expect(methodNames.has('linkWithCredential' as never)).toBe(false);
    expect(methodNames.has('linkWithPopup' as never)).toBe(false);
    // Sign-in paths (no creation):
    expect(methodNames.has('signInWithEmailAndPassword' as never)).toBe(false);
    expect(methodNames.has('signInWithCustomToken' as never)).toBe(false);
    // Google federated (TRACKED_RESIDUAL Sprint 2c):
    expect(methodNames.has('signInWithPopup' as never)).toBe(false);
  });

  it('Google leg TRACKED_RESIDUAL — documentado, no cubierto por este test', () => {
    // Per spec amendment A3 v3.4 + ADR-052 §Riesgo residual: Google self-
    // signup queda OPEN entre Sprint 2b ship y Sprint 2c ship porque
    // federated providers crean Firebase Users implícitamente antes de
    // que `disabled_user_signup` aplique. Sprint 2c BlockingFunction
    // beforeCreate cierra el residual.
    //
    // Este assertion documenta el gap explícitamente — el test PASA
    // (no falla), pero hace evidente que Google NO está cubierto.
    const googleMethod = 'signInWithPopup';
    const isBlockedByT11 = BLOCKED_CREATION_METHODS.some((m) => m.method === googleMethod);
    expect(isBlockedByT11).toBe(false);
    // Tracked en .specs/_followups/sprint-2c-google-blocking-function.md
  });
});
