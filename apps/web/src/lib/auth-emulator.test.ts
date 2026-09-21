import { describe, expect, it } from 'vitest';
import { AUTH_EMULATOR_DEFAULT_ORIGIN, resolveAuthEmulatorOrigin } from './auth-emulator.js';

describe('resolveAuthEmulatorOrigin', () => {
  it('default es http://127.0.0.1:9099', () => {
    expect(AUTH_EMULATOR_DEFAULT_ORIGIN).toBe('http://127.0.0.1:9099');
    expect(resolveAuthEmulatorOrigin(undefined)).toBe('http://127.0.0.1:9099');
  });

  it('acepta loopback 127.0.0.1, localhost y ::1', () => {
    expect(resolveAuthEmulatorOrigin('http://127.0.0.1:9099')).toBe('http://127.0.0.1:9099');
    expect(resolveAuthEmulatorOrigin('http://localhost:9099/')).toBe('http://localhost:9099');
    expect(resolveAuthEmulatorOrigin('http://[::1]:9099')).toBe('http://[::1]:9099');
  });

  it('rechaza un host que no es loopback — nunca Identity Platform', () => {
    expect(() => resolveAuthEmulatorOrigin('https://identitytoolkit.googleapis.com')).toThrow(
      /loopback|Identity Platform/i,
    );
    expect(() => resolveAuthEmulatorOrigin('https://securetoken.google.com')).toThrow(
      /loopback|Identity Platform/i,
    );
    expect(() => resolveAuthEmulatorOrigin('http://auth.boosterchile.com:9099')).toThrow(
      /loopback/i,
    );
  });

  it('rechaza un origin malformado', () => {
    expect(() => resolveAuthEmulatorOrigin('no-es-url')).toThrow(/inválid/i);
  });
});
