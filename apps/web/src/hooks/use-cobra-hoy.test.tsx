import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import {
  useCotizacionCobraHoy,
  useHistorialCobraHoy,
  useSolicitarCobraHoyMutation,
} from './use-cobra-hoy.js';

type RetryFn = (failureCount: number, error: Error) => boolean;

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  /** La política de reintento que el hook le pasó a la query. */
  const retryDe = (prefijo: readonly unknown[]) =>
    client.getQueryCache().find({ queryKey: prefijo })?.options.retry as RetryFn;
  return { client, Wrapper, retryDe };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCotizacionCobraHoy', () => {
  it('no consulta hasta que se habilita', () => {
    const get = vi.spyOn(api, 'get');
    const { Wrapper } = makeWrapper();
    renderHook(() => useCotizacionCobraHoy('asg-1'), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it('habilitada, pide la cotización de la asignación', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ monto_neto_clp: 100_000 });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCotizacionCobraHoy('asg-1', { enabled: true }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/assignments/asg-1/cobra-hoy/cotizacion');
  });

  it('no reintenta 503, 403 ni 409; sí otros errores hasta 2 veces', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({});
    const { Wrapper, retryDe } = makeWrapper();
    renderHook(() => useCotizacionCobraHoy('asg-1', { enabled: true }), { wrapper: Wrapper });
    const retry = retryDe(['cobra-hoy', 'cotizacion', 'asg-1']);

    for (const status of [503, 403, 409]) {
      expect(retry(0, new ApiError(status, undefined, null))).toBe(false);
    }
    expect(retry(0, new ApiError(500, undefined, null))).toBe(true);
    expect(retry(1, new Error('red'))).toBe(true);
    expect(retry(2, new Error('red'))).toBe(false);
  });
});

describe('useSolicitarCobraHoyMutation', () => {
  it('solicita el adelanto e invalida las queries de cobra-hoy', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ ok: true, already_requested: false, adelanto_id: 'ad-1' });
    const { Wrapper, client } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSolicitarCobraHoyMutation('asg-1'), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(post).toHaveBeenCalledWith('/assignments/asg-1/cobra-hoy', {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cobra-hoy'] });
  });

  it('solicitud duplicada: devuelve already_requested sin fallar', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      already_requested: true,
      adelanto_id: 'ad-1',
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSolicitarCobraHoyMutation('asg-1'), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.data?.already_requested).toBe(true));
  });

  it('solicitud rechazada (422): expone el error y no invalida', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'shipper_no_aprobado', null));
    const { Wrapper, client } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSolicitarCobraHoyMutation('asg-1'), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(422);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useHistorialCobraHoy', () => {
  it('consulta por defecto el historial del carrier', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useHistorialCobraHoy(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get.mock.calls[0]?.[0]).toBe('/me/cobra-hoy/historial');
  });

  it('deshabilitado no consulta; habilitado no reintenta 503', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    const { Wrapper, client } = makeWrapper();
    renderHook(() => useHistorialCobraHoy({ enabled: false }), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();

    const retry = client.getQueryCache().getAll()[0]?.options.retry as RetryFn;
    expect(retry(0, new ApiError(503, undefined, null))).toBe(false);
    expect(retry(0, new ApiError(500, undefined, null))).toBe(true);
    expect(retry(2, new Error('red'))).toBe(false);
  });
});
