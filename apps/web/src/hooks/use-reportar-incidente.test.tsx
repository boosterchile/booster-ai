import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  useReportarIncidenteMutation,
} from './use-reportar-incidente.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return {
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
    client,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('INCIDENT_TYPES + LABELS', () => {
  it('5 tipos canónicos', () => {
    expect(INCIDENT_TYPES.length).toBe(5);
    expect(INCIDENT_TYPES).toEqual([
      'accidente',
      'demora',
      'falla_mecanica',
      'problema_carga',
      'otro',
    ]);
  });

  it('cada tipo tiene label legible', () => {
    for (const t of INCIDENT_TYPES) {
      expect(INCIDENT_TYPE_LABELS[t]).toBeTruthy();
      expect(INCIDENT_TYPE_LABELS[t].length).toBeGreaterThan(2);
    }
  });
});

describe('useReportarIncidenteMutation', () => {
  it('llama POST /assignments/:id/incidents con body correcto', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      trip_event_id: 'e-1',
      recorded_at: '2026-05-10T18:00:00Z',
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useReportarIncidenteMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        assignmentId: 'a-1',
        incidentType: 'demora',
        description: 'tráfico denso',
      });
    });

    expect(postSpy).toHaveBeenCalledWith('/assignments/a-1/incidents', {
      incident_type: 'demora',
      description: 'tráfico denso',
    });
  });

  it('description opcional: NO se envía si es undefined', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      trip_event_id: 'e-1',
      recorded_at: '2026-05-10T18:00:00Z',
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useReportarIncidenteMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        assignmentId: 'a-1',
        incidentType: 'accidente',
      });
    });

    expect(postSpy).toHaveBeenCalledWith('/assignments/a-1/incidents', {
      incident_type: 'accidente',
    });
  });

  it('invalida assignment-detail tras success', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      trip_event_id: 'e-1',
      recorded_at: '2026-05-10T18:00:00Z',
    });
    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReportarIncidenteMutation(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        assignmentId: 'a-77',
        incidentType: 'falla_mecanica',
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calls = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown }).queryKey);
    expect(calls).toContainEqual(['assignment-detail', 'a-77']);
  });

  it('propaga ApiError 403', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(403, 'forbidden_owner_mismatch', { code: 'forbidden_owner_mismatch' }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useReportarIncidenteMutation(), { wrapper: Wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          assignmentId: 'a-1',
          incidentType: 'otro',
        });
      } catch {
        // expected
      }
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(403);
  });
});
