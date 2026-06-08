import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignupPage from './page.js';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('SignupPage — kill-switch gate', () => {
  it('off → "próximamente" sin form', () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNUP_ENABLED', 'false');
    render(<SignupPage />);
    expect(screen.getByRole('link', { name: /soporte@boosterchile\.com/i })).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  // ALTA-1 (test-engineer): la rama POSITIVA del gate es el control de seguridad
  // central. Sin este test, invertir `if (!isSignupEnabled())` queda verde.
  it('on → monta el form (Email presente) y NO ComingSoon', async () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNUP_ENABLED', 'true');
    render(<SignupPage />);
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /soporte@boosterchile\.com/i })).toBeNull();
  });
});
