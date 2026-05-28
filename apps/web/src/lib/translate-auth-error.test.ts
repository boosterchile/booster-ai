import { describe, expect, it } from 'vitest';
import { translateAuthError } from './translate-auth-error';

/**
 * Sprint 2c-B T2 tests — `translateAuthError` extraction + extension.
 *
 * Preserves all 10 existing cases from the inline function previously
 * in `apps/web/src/routes/login.tsx:382-406`. Adds new
 * `auth/internal-error` branch with `BLOCKED_SIGNUP_PENDING_APPROVAL`
 * substring detection (Sprint 2c-A T7 handler returns this code; Firebase
 * web SDK wraps as `auth/internal-error` with custom message per ADR-054).
 */

describe('translateAuthError — existing codes preserved verbatim', () => {
  it('auth/invalid-credential → password incorrect message', () => {
    expect(translateAuthError('auth/invalid-credential')).toBe('Email o contraseña incorrectos.');
  });

  it('auth/invalid-login-credentials → same fallthrough message', () => {
    expect(translateAuthError('auth/invalid-login-credentials')).toBe(
      'Email o contraseña incorrectos.',
    );
  });

  it('auth/user-not-found', () => {
    expect(translateAuthError('auth/user-not-found')).toBe('No existe una cuenta con ese email.');
  });

  it('auth/wrong-password', () => {
    expect(translateAuthError('auth/wrong-password')).toBe('Contraseña incorrecta.');
  });

  it('auth/user-disabled — references support email', () => {
    expect(translateAuthError('auth/user-disabled')).toBe(
      'Esta cuenta está deshabilitada. Contacta a soporte@boosterchile.com.',
    );
  });

  it('auth/email-already-in-use → signup-existing-account copy (login domain)', () => {
    expect(translateAuthError('auth/email-already-in-use')).toBe(
      'Ya existe una cuenta con ese email. Inicia sesión.',
    );
  });

  it('auth/weak-password', () => {
    expect(translateAuthError('auth/weak-password')).toBe(
      'La contraseña es muy débil. Usa al menos 6 caracteres.',
    );
  });

  it('auth/invalid-email', () => {
    expect(translateAuthError('auth/invalid-email')).toBe('El email no es válido.');
  });

  it('auth/too-many-requests', () => {
    expect(translateAuthError('auth/too-many-requests')).toBe(
      'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.',
    );
  });

  it('auth/network-request-failed', () => {
    expect(translateAuthError('auth/network-request-failed')).toBe(
      'Sin conexión a internet. Intenta de nuevo.',
    );
  });
});

describe('translateAuthError — auth/internal-error new branch (Sprint 2c-B)', () => {
  it('auth/internal-error with BLOCKED_SIGNUP_PENDING_APPROVAL substring → blocked-signup message', () => {
    expect(
      translateAuthError(
        'auth/internal-error',
        'Cloud Function returned an error: BLOCKED_SIGNUP_PENDING_APPROVAL',
      ),
    ).toBe(
      'Tu solicitud de registro debe ser aprobada por un administrador antes de poder iniciar sesión. Si ya solicitaste registro, espera la confirmación por email.',
    );
  });

  it('auth/internal-error with BLOCKED literal embedded in JSON-ish wrap → still matches', () => {
    expect(
      translateAuthError(
        'auth/internal-error',
        '{"error":{"message":"HTTP Cloud Function returned a custom error... BLOCKED_SIGNUP_PENDING_APPROVAL"}}',
      ),
    ).toMatch(/aprobada por un administrador/);
  });

  it('auth/internal-error WITHOUT BLOCKED literal → fallback null', () => {
    expect(
      translateAuthError('auth/internal-error', 'Some other generic internal error'),
    ).toBeNull();
  });

  it('auth/internal-error with no message argument → fallback null', () => {
    expect(translateAuthError('auth/internal-error')).toBeNull();
  });
});

describe('translateAuthError — fallback null for unmapped codes', () => {
  it('unknown code → null', () => {
    expect(translateAuthError('auth/something-unmapped')).toBeNull();
  });

  it('undefined code → null', () => {
    expect(translateAuthError(undefined)).toBeNull();
  });

  it('empty string → null', () => {
    expect(translateAuthError('')).toBeNull();
  });
});
