import { describe, expect, it } from 'vitest';
import { translateLoginAuthError, translateProviderAuthError } from './translate-auth-error';

/**
 * Tests de `translateLoginAuthError` (dominio login/signup) y
 * `translateProviderAuthError` (dominio provider-linking), colocados en el
 * mismo módulo (translate-auth-error-unify, Opción B). Copy diferenciado por
 * dominio para los códigos que se solapan — los tests lo fijan.
 */

describe('translateLoginAuthError — existing codes preserved verbatim', () => {
  it('auth/invalid-credential → password incorrect message', () => {
    expect(translateLoginAuthError('auth/invalid-credential')).toBe(
      'Email o contraseña incorrectos.',
    );
  });

  it('auth/invalid-login-credentials → same fallthrough message', () => {
    expect(translateLoginAuthError('auth/invalid-login-credentials')).toBe(
      'Email o contraseña incorrectos.',
    );
  });

  it('auth/user-not-found', () => {
    expect(translateLoginAuthError('auth/user-not-found')).toBe(
      'No existe una cuenta con ese email.',
    );
  });

  it('auth/wrong-password', () => {
    expect(translateLoginAuthError('auth/wrong-password')).toBe('Contraseña incorrecta.');
  });

  it('auth/user-disabled — references support email', () => {
    expect(translateLoginAuthError('auth/user-disabled')).toBe(
      'Esta cuenta está deshabilitada. Contacta a soporte@boosterchile.com.',
    );
  });

  it('auth/email-already-in-use → signup-existing-account copy (login domain)', () => {
    expect(translateLoginAuthError('auth/email-already-in-use')).toBe(
      'Ya existe una cuenta con ese email. Inicia sesión.',
    );
  });

  it('auth/weak-password', () => {
    expect(translateLoginAuthError('auth/weak-password')).toBe(
      'La contraseña es muy débil. Usa al menos 6 caracteres.',
    );
  });

  it('auth/invalid-email', () => {
    expect(translateLoginAuthError('auth/invalid-email')).toBe('El email no es válido.');
  });

  it('auth/too-many-requests', () => {
    expect(translateLoginAuthError('auth/too-many-requests')).toBe(
      'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.',
    );
  });

  it('auth/network-request-failed', () => {
    expect(translateLoginAuthError('auth/network-request-failed')).toBe(
      'Sin conexión a internet. Intenta de nuevo.',
    );
  });
});

describe('translateLoginAuthError — auth/internal-error new branch (Sprint 2c-B)', () => {
  it('auth/internal-error with BLOCKED_SIGNUP_PENDING_APPROVAL substring → blocked-signup message', () => {
    expect(
      translateLoginAuthError(
        'auth/internal-error',
        'Cloud Function returned an error: BLOCKED_SIGNUP_PENDING_APPROVAL',
      ),
    ).toBe(
      'Tu solicitud de registro debe ser aprobada por un administrador antes de poder iniciar sesión. Si ya solicitaste registro, espera la confirmación por email.',
    );
  });

  it('auth/internal-error with BLOCKED literal embedded in JSON-ish wrap → still matches', () => {
    expect(
      translateLoginAuthError(
        'auth/internal-error',
        '{"error":{"message":"HTTP Cloud Function returned a custom error... BLOCKED_SIGNUP_PENDING_APPROVAL"}}',
      ),
    ).toMatch(/aprobada por un administrador/);
  });

  it('auth/internal-error WITHOUT BLOCKED literal → fallback null', () => {
    expect(
      translateLoginAuthError('auth/internal-error', 'Some other generic internal error'),
    ).toBeNull();
  });

  it('auth/internal-error with no message argument → fallback null', () => {
    expect(translateLoginAuthError('auth/internal-error')).toBeNull();
  });
});

describe('translateLoginAuthError — fallback null for unmapped codes', () => {
  it('unknown code → null', () => {
    expect(translateLoginAuthError('auth/something-unmapped')).toBeNull();
  });

  it('undefined code → null', () => {
    expect(translateLoginAuthError(undefined)).toBeNull();
  });

  it('empty string → null', () => {
    expect(translateLoginAuthError('')).toBeNull();
  });
});

describe('translateProviderAuthError — dominio provider-linking', () => {
  it('auth/credential-already-in-use → copy de linking', () => {
    expect(translateProviderAuthError('auth/credential-already-in-use')).toBe(
      'Esa cuenta ya pertenece a otro usuario de Booster. Cerrá sesión y entrá con esa cuenta directamente.',
    );
  });

  it('auth/provider-already-linked', () => {
    expect(translateProviderAuthError('auth/provider-already-linked')).toBe(
      'Este proveedor ya está vinculado a tu cuenta.',
    );
  });

  it('auth/popup-blocked', () => {
    expect(translateProviderAuthError('auth/popup-blocked')).toBe(
      'El navegador bloqueó el popup. Permite popups para app.boosterchile.com.',
    );
  });

  it('auth/no-such-provider', () => {
    expect(translateProviderAuthError('auth/no-such-provider')).toBe(
      'No puedes quitar este proveedor porque es el único que tienes.',
    );
  });

  it('código no mapeado → null', () => {
    expect(translateProviderAuthError('auth/something-unmapped')).toBeNull();
  });
});

describe('copy DIVERGE por dominio en códigos solapados (invariante de unify)', () => {
  // El mismo código produce copy distinto por dominio — es intencional (UX).
  it('auth/email-already-in-use: login dice "Inicia sesión", linking dice "Cerrá sesión"', () => {
    const login = translateLoginAuthError('auth/email-already-in-use');
    const provider = translateProviderAuthError('auth/email-already-in-use');
    expect(login).toBe('Ya existe una cuenta con ese email. Inicia sesión.');
    expect(provider).toBe(
      'Esa cuenta ya pertenece a otro usuario de Booster. Cerrá sesión y entrá con esa cuenta directamente.',
    );
    expect(login).not.toBe(provider);
  });

  it('auth/weak-password: login "Usa", linking "Usá" (voseo)', () => {
    expect(translateLoginAuthError('auth/weak-password')).toContain('Usa al menos');
    expect(translateProviderAuthError('auth/weak-password')).toContain('Usá al menos');
  });
});
