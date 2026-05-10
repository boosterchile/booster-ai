import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase ANTES del import de api-client (que importa firebase).
const getIdTokenMock = vi.fn(async () => 'firebase-id-token');
const currentUserMock = { getIdToken: getIdTokenMock };
vi.mock('./firebase.js', () => ({
  firebaseAuth: {
    get currentUser() {
      return currentUserState.value;
    },
  },
}));

// Estado mutable para currentUser
const currentUserState: { value: typeof currentUserMock | null } = { value: currentUserMock };

const { ApiError, api, getActiveEmpresaId, setActiveEmpresaId } = await import('./api-client.js');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  currentUserState.value = currentUserMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getActiveEmpresaId / setActiveEmpresaId', () => {
  it('null inicial', () => {
    expect(getActiveEmpresaId()).toBeNull();
  });

  it('set + get', () => {
    setActiveEmpresaId('emp-uuid-1');
    expect(getActiveEmpresaId()).toBe('emp-uuid-1');
  });

  it('set null borra el storage', () => {
    setActiveEmpresaId('emp-1');
    setActiveEmpresaId(null);
    expect(getActiveEmpresaId()).toBeNull();
  });
});

describe('api.get', () => {
  it('agrega Authorization Bearer + X-Empresa-Id si está seteado', async () => {
    setActiveEmpresaId('emp-active');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await api.get<{ ok: boolean }>('/me');
    expect(result).toEqual({ ok: true });
    const call = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(call.headers);
    expect(headers.get('authorization')).toBe('Bearer firebase-id-token');
    expect(headers.get('x-empresa-id')).toBe('emp-active');
  });

  it('sin user → no Authorization header', async () => {
    currentUserState.value = null;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await api.get('/health');
    const call = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(call.headers);
    expect(headers.get('authorization')).toBeNull();
  });

  it('sin activeEmpresaId → no X-Empresa-Id header', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await api.get('/me');
    const call = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(call.headers);
    expect(headers.get('x-empresa-id')).toBeNull();
  });

  it('path sin / inicial agrega /', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await api.get('me');
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/\/me$/);
  });

  it('204 No Content → undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await api.get('/empty');
    expect(result).toBeUndefined();
  });

  it('error 4xx con JSON {code, error} → ApiError con esos campos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'forbidden_owner_mismatch', error: 'no autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      await api.get('/secret');
      throw new Error('expected ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as InstanceType<typeof ApiError>;
      expect(e.status).toBe(403);
      expect(e.code).toBe('forbidden_owner_mismatch');
    }
  });

  it('error sin code en payload → ApiError code=undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('plain text error', { status: 500 }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({ status: 500, code: undefined });
  });
});

describe('api.post', () => {
  it('agrega Content-Type json + serializa body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'uuid' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await api.post('/trip-requests', { foo: 'bar' });
    const call = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(call.method).toBe('POST');
    expect(call.body).toBe('{"foo":"bar"}');
    expect(new Headers(call.headers).get('content-type')).toBe('application/json');
  });
});

describe('api.patch / api.put', () => {
  it('patch con body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await api.patch('/me/profile', { full_name: 'Felipe' });
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('put con body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await api.put('/x', { v: 1 });
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('PUT');
  });
});

describe('api.delete', () => {
  it('delete sin body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.delete('/me/push-subscription');
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('delete con body (RFC 7231)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await api.delete('/me/push-subscription', { endpoint: 'https://x' });
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe('{"endpoint":"https://x"}');
  });

  it('delete con RequestInit (no body) — primer arg detectado como init', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const ctrl = new AbortController();
    await api.delete('/x', { signal: ctrl.signal });
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('DELETE');
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
});

describe('ApiError', () => {
  it('mensaje default cuando no se da', () => {
    const e = new ApiError(403, 'forbidden', null);
    expect(e.message).toBe('API error 403 (forbidden)');
  });

  it('mensaje custom', () => {
    const e = new ApiError(500, undefined, null, 'todo mal');
    expect(e.message).toBe('todo mal');
  });

  it('preserva status, code, details', () => {
    const e = new ApiError(404, 'not_found', { detail: 'x' });
    expect(e.status).toBe(404);
    expect(e.code).toBe('not_found');
    expect(e.details).toEqual({ detail: 'x' });
  });
});
