import { describe, expect, it, vi } from 'vitest';

// Mock de google-auth-library: en CI no hay ADC disponible (no Cloud Run,
// no `gcloud auth application-default login`), pero el cliente production
// llama getAccessToken() en cada request. Devolvemos un token fake para
// que los tests del cliente puedan ejercitar la lógica de fetch/parse sin
// tocar ADC real.
vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getClient: vi.fn().mockResolvedValue({
      getAccessToken: vi.fn().mockResolvedValue({ token: 'test-access-token' }),
    }),
  })),
}));

import {
  type RouteSuggestion,
  RoutesApiError,
  computeRoutes,
} from '../../src/services/routes-api.js';

/**
 * Tests del cliente Routes API (Phase 1 — eco route suggestion).
 *
 * Mockean `fetch` directamente con `vi.fn()` — el contrato del Routes
 * API es simple (POST + JSON in/out), no hay valor en usar msw.
 *
 * Cobertura:
 *   - Request body bien formado (origen, destino, vehicle info, field mask)
 *   - Field mask cambia según haya emissionType (con/sin FUEL_CONSUMPTION)
 *   - Parse de response: distanceMeters → km, microliters → liters,
 *     duration "1234s" → 1234
 *   - Errores HTTP: 400/401/403/429 mapean a RoutesApiError con code
 *     correcto
 *   - Errores de red (fetch throws) → RoutesApiError network_error
 *   - Response sin rutas → [] (no throw)
 */

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

function makeFetchError(status: number, body = '{"error":"..."}'): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe('computeRoutes — request body', () => {
  it('arma origin + destination como address strings', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ routes: [] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await computeRoutes({
      projectId: 'test-project',
      origin: 'Av. Apoquindo 5400, Las Condes',
      destination: 'Calle 1 Norte 123, Concepción',
      fetchImpl: fetchSpy,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const callArgs = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs?.[0]).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const init = callArgs?.[1] as RequestInit;
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed.origin).toEqual({ address: 'Av. Apoquindo 5400, Las Condes' });
    expect(parsed.destination).toEqual({ address: 'Calle 1 Norte 123, Concepción' });
    expect(parsed.travelMode).toBe('DRIVE');
    expect(parsed.routingPreference).toBe('TRAFFIC_AWARE_OPTIMAL');
  });

  it('incluye vehicleInfo + extraComputations cuando hay emissionType', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ routes: [] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      emissionType: 'DIESEL',
      fetchImpl: fetchSpy,
    });

    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed.vehicleInfo).toEqual({ emissionType: 'DIESEL' });
    expect(parsed.extraComputations).toEqual(['FUEL_CONSUMPTION']);

    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toContain(
      'routes.travelAdvisory.fuelConsumptionMicroliters',
    );
  });

  it('omite vehicleInfo + FUEL_CONSUMPTION cuando NO hay emissionType (cobra menos)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ routes: [] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      fetchImpl: fetchSpy,
    });

    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed.vehicleInfo).toBeUndefined();
    expect(parsed.extraComputations).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).not.toContain('fuelConsumption');
  });

  it('computeAlternatives=true se propaga a la request', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ routes: [] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      computeAlternatives: true,
      fetchImpl: fetchSpy,
    });

    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed.computeAlternativeRoutes).toBe(true);
  });
});

describe('computeRoutes — response parsing', () => {
  it('normaliza distanceMeters → km y duration "1234s" → 1234', async () => {
    const fetchImpl = makeFetchOk({
      routes: [
        {
          distanceMeters: 142000,
          duration: '5400s',
          polyline: { encodedPolyline: 'abc123' },
        },
      ],
    });

    const routes = await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      fetchImpl,
    });

    expect(routes).toEqual<RouteSuggestion[]>([
      {
        distanceKm: 142,
        durationS: 5400,
        fuelL: null,
        polylineEncoded: 'abc123',
      },
    ]);
  });

  it('convierte fuelConsumptionMicroliters → litros', async () => {
    const fetchImpl = makeFetchOk({
      routes: [
        {
          distanceMeters: 100000,
          duration: '3600s',
          polyline: { encodedPolyline: 'xyz' },
          travelAdvisory: { fuelConsumptionMicroliters: '12000000' }, // 12 L
        },
      ],
    });

    const [r] = await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      emissionType: 'DIESEL',
      fetchImpl,
    });

    expect(r?.fuelL).toBe(12);
  });

  it('response con múltiples rutas → array completo', async () => {
    const fetchImpl = makeFetchOk({
      routes: [
        { distanceMeters: 100000, duration: '3600s', polyline: { encodedPolyline: 'p1' } },
        { distanceMeters: 110000, duration: '4000s', polyline: { encodedPolyline: 'p2' } },
        { distanceMeters: 95000, duration: '5400s', polyline: { encodedPolyline: 'p3' } },
      ],
    });

    const routes = await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      computeAlternatives: true,
      fetchImpl,
    });

    expect(routes).toHaveLength(3);
    expect(routes[0]?.distanceKm).toBe(100);
    expect(routes[1]?.distanceKm).toBe(110);
    expect(routes[2]?.distanceKm).toBe(95);
  });

  it('response sin rutas → [] (no throw)', async () => {
    const fetchImpl = makeFetchOk({}); // sin field "routes"
    const routes = await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      fetchImpl,
    });
    expect(routes).toEqual([]);
  });

  it('response con campos faltantes → defaults defensivos', async () => {
    const fetchImpl = makeFetchOk({
      routes: [{}], // ruta sin nada
    });
    const [r] = await computeRoutes({
      projectId: 'test-project',
      origin: 'A',
      destination: 'B',
      fetchImpl,
    });
    expect(r).toEqual<RouteSuggestion>({
      distanceKm: 0,
      durationS: 0,
      fuelL: null,
      polylineEncoded: '',
    });
  });
});

describe('computeRoutes — errores HTTP', () => {
  it('400 → invalid_request', async () => {
    const fetchImpl = makeFetchError(400, 'Origin not parseable');
    await expect(
      computeRoutes({
        projectId: 'test-project',
        origin: 'invalid',
        destination: 'B',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: 'RoutesApiError',
      code: 'invalid_request',
      httpStatus: 400,
    });
  });

  it('401 y 403 → auth_error', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = makeFetchError(status);
      await expect(
        computeRoutes({ projectId: 'test-project', origin: 'A', destination: 'B', fetchImpl }),
      ).rejects.toMatchObject({ code: 'auth_error', httpStatus: status });
    }
  });

  it('429 → quota_exceeded', async () => {
    const fetchImpl = makeFetchError(429);
    await expect(
      computeRoutes({ projectId: 'test-project', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ code: 'quota_exceeded', httpStatus: 429 });
  });

  it('500 → unknown', async () => {
    const fetchImpl = makeFetchError(500);
    await expect(
      computeRoutes({ projectId: 'test-project', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ code: 'unknown', httpStatus: 500 });
  });

  it('fetch throws (network error) → RoutesApiError network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection reset by peer');
    }) as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'test-project', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({
      code: 'network_error',
      httpStatus: null,
    });
  });
});

describe('RoutesApiError', () => {
  it('es Error y captura código + status', () => {
    const e = new RoutesApiError('msg', 'auth_error', 403);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('RoutesApiError');
    expect(e.code).toBe('auth_error');
    expect(e.httpStatus).toBe(403);
  });
});
