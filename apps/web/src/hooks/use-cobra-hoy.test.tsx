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

  it('deshabilitado no consulta', () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    const { Wrapper } = makeWrapper();
    renderHook(() => useHistorialCobraHoy({ enabled: false }), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useCotizacionCobraHoy: reintentos', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([503, 403, 409])('%i: 1 sola request, sin retry', async (status) => {
    const n = await contarLlamadas(
      (wrapper) => renderHook(() => useCotizacionCobraHoy('asg-1', { enabled: true }), { wrapper }),
      new ApiError(status, undefined, null),
    );
    expect(n).toBe(1);
  });

  it.each([
    ['500', new ApiError(500, undefined, null)],
    ['error de red', new Error('red')],
  ])('%s: 1 request + 2 reintentos', async (_caso, error) => {
    const n = await contarLlamadas(
      (wrapper) => renderHook(() => useCotizacionCobraHoy('asg-1', { enabled: true }), { wrapper }),
      error,
    );
    expect(n).toBe(3);
  });
});

describe('useHistorialCobraHoy: reintentos', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([503])('%i: 1 sola request, sin retry', async (status) => {
    const n = await contarLlamadas(
      (wrapper) => renderHook(() => useHistorialCobraHoy(), { wrapper }),
      new ApiError(status, undefined, null),
    );
    expect(n).toBe(1);
  });

  it.each([
    ['500', new ApiError(500, undefined, null)],
    ['error de red', new Error('red')],
  ])('%s: 1 request + 2 reintentos', async (_caso, error) => {
    const n = await contarLlamadas(
      (wrapper) => renderHook(() => useHistorialCobraHoy(), { wrapper }),
      error,
    );
    expect(n).toBe(3);
  });
});
