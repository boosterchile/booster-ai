import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import { useAdminAdelantos, useTransicionarAdelantoMutation } from './use-admin-cobra-hoy.js';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Cuenta las llamadas a api.get que hace el hook cuando la API falla con `error`,
 * dejando correr los reintentos reales (retry y retryDelay por defecto de TanStack).
 */
async function contarLlamadas(
  render: (wrapper: ({ children }: { children: ReactNode }) => ReactNode) => void,
  error: Error,
) {
  vi.useFakeTimers();
  const get = vi.spyOn(api, 'get').mockRejectedValue(error);
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  render(({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>);
  for (const ms of [20, 1_000, 2_000, 4_000, 60_000]) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  return get.mock.calls.length;
}

describe('useAdminAdelantos', () => {
  it('sin filtros pide la lista sin query string', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAdminAdelantos({}), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/admin/cobra-hoy/adelantos');
  });

  it('arma la query string con los tres filtros', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useAdminAdelantos({
          status: 'solicitado',
          empresaCarrierId: 'car-1',
          empresaShipperId: 'shp-1',
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(
      '/admin/cobra-hoy/adelantos?status=solicitado&empresa_carrier_id=car-1&empresa_shipper_id=shp-1',
    );
  });

  it('deshabilitado no consulta', () => {
    const get = vi.spyOn(api, 'get');
    const { Wrapper } = makeWrapper();
    renderHook(() => useAdminAdelantos({}, { enabled: false }), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useTransicionarAdelantoMutation', () => {
  it('rechazo con notas: manda las notas e invalida admin y carrier', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 'rechazado' });
    const { Wrapper, client } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTransicionarAdelantoMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        adelantoId: 'ad-1',
        targetStatus: 'rechazado',
        notas: 'Shipper sin línea',
      });
    });

    expect(post).toHaveBeenCalledWith('/admin/cobra-hoy/adelantos/ad-1/transicionar', {
      target_status: 'rechazado',
      notas: 'Shipper sin línea',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-cobra-hoy'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cobra-hoy'] });
  });

  it('sin notas no manda el campo', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 'aprobado' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTransicionarAdelantoMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ adelantoId: 'ad-1', targetStatus: 'aprobado' });
    });

    expect(post).toHaveBeenCalledWith('/admin/cobra-hoy/adelantos/ad-1/transicionar', {
      target_status: 'aprobado',
    });
  });

  it('transición inválida (409): expone el error y no invalida', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, 'transicion_invalida', null));
    const { Wrapper, client } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTransicionarAdelantoMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ adelantoId: 'ad-1', targetStatus: 'desembolsado' }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useAdminAdelantos: reintentos', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([503, 403])('%i: 1 sola request, sin retry', async (status) => {
    const n = await contarLlamadas(
      (wrapper) => renderHook(() => useAdminAdelantos({}), { wrapper }),
      new ApiError(status, undefined, null),
    );
    expect(n).toBe(1);
  });

  it.each([
    ['500', new ApiError(500, undefined, null)],
    ['error de red', new Error('red')],
  ])('%s: 1 request + 2 reintentos', async (_caso, error) => {
    const n = await contarLlamadas(
      (wrapper) => renderHook(() => useAdminAdelantos({}), { wrapper }),
      error,
    );
    expect(n).toBe(3);
  });
});
