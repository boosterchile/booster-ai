import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ permanentRedirect: vi.fn() }));

import { permanentRedirect } from 'next/navigation';
import IngresarPage from './page.js';

describe('IngresarPage', () => {
  it('redirige server-side (308) al login de la app', () => {
    // Envuelto: IngresarPage tiene tipo de retorno `never` (permanentRedirect
    // lanza en runtime real), así TS no marca el assert siguiente como código
    // inalcanzable. El mock no lanza, así que no hay throw.
    expect(() => IngresarPage()).not.toThrow();
    expect(vi.mocked(permanentRedirect)).toHaveBeenCalledWith('https://app.boosterchile.com/login');
  });
});
