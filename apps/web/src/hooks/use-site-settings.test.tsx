import { DEFAULT_SITE_CONFIG } from '@booster-ai/shared-schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSiteSettings } from './use-site-settings.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSiteSettings', () => {
  it('devuelve DEFAULT_SITE_CONFIG inicialmente (mientras query corre)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, config: DEFAULT_SITE_CONFIG }),
    });
    const { result } = renderHook(() => useSiteSettings(), { wrapper: makeWrapper() });
    expect(result.current.config).toEqual(DEFAULT_SITE_CONFIG);
  });

  it('cuando fetch falla → devuelve DEFAULT_SITE_CONFIG (fallback)', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useSiteSettings(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.config).toEqual(DEFAULT_SITE_CONFIG);
  });

  it('cuando response 404 → devuelve DEFAULT_SITE_CONFIG', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const { result } = renderHook(() => useSiteSettings(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.config).toEqual(DEFAULT_SITE_CONFIG);
  });

  it('cuando response es válido → devuelve config del API', async () => {
    const customConfig = {
      ...DEFAULT_SITE_CONFIG,
      hero: {
        ...DEFAULT_SITE_CONFIG.hero,
        headline_line1: 'Custom headline,',
      },
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: 5, config: customConfig }),
    });
    const { result } = renderHook(() => useSiteSettings(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.config.hero.headline_line1).toBe('Custom headline,');
    });
  });

  it('cuando response es inválido (falta campo requerido) → fallback a default', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 1,
        config: { identity: {}, hero: { headline_line1: '' } }, // inválido
      }),
    });
    const { result } = renderHook(() => useSiteSettings(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.config).toEqual(DEFAULT_SITE_CONFIG);
  });
});
