import { describe, expect, it, vi } from 'vitest';
import { postSignupRequest } from './signup-client.js';

const VALID = { email: 'ana@empresa.cl', nombreCompleto: 'Ana Díaz' };
const API = 'https://api.test';

function mockFetch(status: number) {
  return vi.fn(async () => ({ status }) as Response);
}

function sentBody(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe('postSignupRequest', () => {
  it('202 → submitted; postea {email,nombreCompleto} por POST a la URL correcta', async () => {
    const fetchImpl = mockFetch(202);
    const out = await postSignupRequest(VALID, { apiUrl: API, fetchImpl });
    expect(out).toBe('submitted');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/v1/signup-request',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sentBody(fetchImpl)).toEqual({ email: 'ana@empresa.cl', nombreCompleto: 'Ana Díaz' });
  });

  it('descarta claves extra del body (defensa de shape del lado cliente)', async () => {
    const fetchImpl = mockFetch(202);
    await postSignupRequest({ ...VALID, rol: 'transportista' } as never, {
      apiUrl: API,
      fetchImpl,
    });
    expect(Object.keys(sentBody(fetchImpl)).sort()).toEqual(['email', 'nombreCompleto']);
  });

  it('NO lee el body del 202 (anti-enumeration: submitted == shadowed)', async () => {
    const json = vi.fn();
    const text = vi.fn();
    const fetchImpl = vi.fn(async () => ({ status: 202, json, text }) as unknown as Response);
    await postSignupRequest(VALID, { apiUrl: API, fetchImpl });
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    [422, 'invalid'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [500, 'unavailable'],
    [403, 'unavailable'],
    [401, 'unavailable'],
  ] as const)(
    'status %i → %s (4xx/5xx no mapeado cae en unavailable)',
    async (status, expected) => {
      const out = await postSignupRequest(VALID, { apiUrl: API, fetchImpl: mockFetch(status) });
      expect(out).toBe(expected);
    },
  );

  it('fetch lanza (red / bloqueo CORS) → network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await postSignupRequest(VALID, { apiUrl: API, fetchImpl });
    expect(out).toBe('network_error');
  });

  it('apiUrl ausente → network_error sin llamar fetch', async () => {
    const fetchImpl = vi.fn();
    const out = await postSignupRequest(VALID, { apiUrl: '', fetchImpl });
    expect(out).toBe('network_error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
