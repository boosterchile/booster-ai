import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSignupEnabled, loadMarketingEnv } from './env.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadMarketingEnv', () => {
  it('signupEnabled true solo con "true" exacto (fail-closed)', () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNUP_ENABLED', 'true');
    expect(loadMarketingEnv().signupEnabled).toBe(true);
    expect(isSignupEnabled()).toBe(true);
  });

  it.each(['false', '1', 'TRUE', ''])('signupEnabled false para "%s"', (v) => {
    vi.stubEnv('NEXT_PUBLIC_SIGNUP_ENABLED', v);
    expect(loadMarketingEnv().signupEnabled).toBe(false);
  });

  it('signupEnabled false cuando la var no está seteada', () => {
    vi.stubEnv('NEXT_PUBLIC_SIGNUP_ENABLED', undefined);
    expect(loadMarketingEnv().signupEnabled).toBe(false);
  });

  it('apiUrl se parsea si es URL válida', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.boosterchile.com');
    expect(loadMarketingEnv().apiUrl).toBe('https://api.boosterchile.com');
  });

  it('lanza si NEXT_PUBLIC_API_URL está presente pero no es URL válida', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'no-es-url');
    expect(() => loadMarketingEnv()).toThrow(/Env de marketing inválida/);
  });
});
