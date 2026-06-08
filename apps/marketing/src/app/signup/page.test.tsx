import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignupPage from './page.js';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('SignupPage — kill-switch gate (off-path)', () => {
  it('con NEXT_PUBLIC_SIGNUP_ENABLED off renderiza "próximamente" sin form', () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNUP_ENABLED', 'false');
    render(<SignupPage />);
    // Estado coming-soon: hay un canal de contacto y NO hay campo de email.
    expect(screen.getByRole('link', { name: /soporte@boosterchile\.com/i })).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});
