import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';
import { useResponderSugerenciaRuta, useSugerenciaRutaActiva } from './use-sugerencia-ruta.js';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSugerenciaRutaActiva', () => {
  it('consulta la sugerencia activa de la asignación', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ sugerencia: null });
    const { result } = renderHook(() => useSugerenciaRutaActiva('a-1', { enabled: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/assignments/a-1/sugerencias-ruta/activa');
    expect(result.current.data).toEqual({ sugerencia: null });
  });

  it('deshabilitado no consulta', () => {
    const spy = vi.spyOn(api, 'get');
    renderHook(() => useSugerenciaRutaActiva('a-1', { enabled: false }), { wrapper: wrapper() });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('useResponderSugerenciaRuta', () => {
  it('POST de la respuesta a la sugerencia', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useResponderSugerenciaRuta('a-1'), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ sugerenciaId: 's-1', respuesta: 'aceptada' });
    });
    expect(spy).toHaveBeenCalledWith('/assignments/a-1/sugerencias-ruta/s-1/respuesta', {
      respuesta: 'aceptada',
    });
  });
});
