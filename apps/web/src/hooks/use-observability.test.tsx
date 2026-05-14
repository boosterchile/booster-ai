import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';
import {
  useObservabilityCloudRun,
  useObservabilityCostsByService,
  useObservabilityCostsOverview,
  useObservabilityHealth,
  useObservabilityTwilio,
} from './use-observability.js';

/**
 * Tests de los hooks TanStack Query del Observability Dashboard.
 *
 * Mockean `api.get` para evitar fetch real. Cada test valida:
 * - El hook llama al endpoint correcto.
 * - Pasa los query params (days, limit) correctamente.
 * - Retorna data al success state.
 */

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useObservabilityHealth', () => {
  it('GET /admin/observability/health', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      overall: 'healthy',
      components: [],
      lastEvaluatedAt: '2026-05-13T20:00:00Z',
    });
    const { result } = renderHook(() => useObservabilityHealth(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/admin/observability/health');
    expect(result.current.data?.overall).toBe('healthy');
  });
});

describe('useObservabilityCostsOverview', () => {
  it('GET /admin/observability/costs/overview', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      costClpMonthToDate: 100000,
      costClpPreviousMonth: 200000,
      costClpPreviousMonthSamePeriod: 90000,
      deltaPercentVsPreviousMonth: 11.1,
      lastBillingExportAt: '2026-05-13T13:00:00Z',
    });
    const { result } = renderHook(() => useObservabilityCostsOverview(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/admin/observability/costs/overview');
    expect(result.current.data?.costClpMonthToDate).toBe(100000);
  });
});

describe('useObservabilityCostsByService', () => {
  it('default days=30', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({ days: 30, items: [] });
    const { result } = renderHook(() => useObservabilityCostsByService(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/admin/observability/costs/by-service?days=30');
  });

  it('custom days=7', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({ days: 7, items: [] });
    const { result } = renderHook(() => useObservabilityCostsByService(7), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/admin/observability/costs/by-service?days=7');
  });
});

describe('useObservabilityCloudRun', () => {
  it('GET /admin/observability/usage/cloud-run', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      latencyP95Ms: 150,
      cpuUtilization: 0.4,
      ramUtilization: 0.5,
      rps: 8,
    });
    const { result } = renderHook(() => useObservabilityCloudRun(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/admin/observability/usage/cloud-run');
    expect(result.current.data?.cpuUtilization).toBe(0.4);
  });
});

describe('useObservabilityTwilio', () => {
  it('available=true con balance y usage', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      available: true,
      balance: { balanceUsd: 42.5, balanceClp: 39313, currency: 'USD' },
      usage: [],
    });
    const { result } = renderHook(() => useObservabilityTwilio(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(true);
  });

  it('available=false si Twilio no configurado', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      available: false,
      reason: 'twilio_credentials_not_configured',
    });
    const { result } = renderHook(() => useObservabilityTwilio(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(false);
  });
});
