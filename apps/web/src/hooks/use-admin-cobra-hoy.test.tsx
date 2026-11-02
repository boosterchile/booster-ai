import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import { useAdminAdelantos, useTransicionarAdelantoMutation } from './use-admin-cobra-hoy.js';

type RetryFn = (failureCount: number, error: Error) => boolean;

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

  it('deshabilitado no consulta; no reintenta 503 ni 403', () => {
    const get = vi.spyOn(api, 'get');
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useAdminAdelantos({}, { enabled: false }), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();

    const retry = client.getQueryCache().getAll()[0]?.options.retry as RetryFn;
    expect(retry(0, new ApiError(503, undefined, null))).toBe(false);
    expect(retry(0, new ApiError(403, undefined, null))).toBe(false);
    expect(retry(1, new ApiError(500, undefined, null))).toBe(true);
    expect(retry(2, new Error('red'))).toBe(false);
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
