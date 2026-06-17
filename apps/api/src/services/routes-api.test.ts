import { afterEach, describe, expect, it, vi } from 'vitest';

// ADC: en test no hay credenciales reales. Mockeamos GoogleAuth con estado
// configurable (mockToken / mockAuthThrows) para ejercer las ramas de auth.
let mockToken: string | null = 'fake-token';
let mockAuthThrows = false;
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getClient() {
      if (mockAuthThrows) {
        return Promise.reject(new Error('adc boom'));
      }
      return Promise.resolve({
        getAccessToken: () => Promise.resolve({ token: mockToken }),
      });
    }
  },
}));

import { ROUTES_API_TIMEOUT_MS, computeRoutes } from './routes-api.js';

/** Response mínima que satisface el subset de la interfaz Response que usa computeRoutes. */
function fakeResponse(init: {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(init.json ?? {}),
    text: () => Promise.resolve(init.text ?? ''),
  } as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockToken = 'fake-token';
  mockAuthThrows = false;
});

describe('computeRoutes', () => {
  it('normaliza la respuesta de Routes API a unidades SI', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: {
          routes: [
            {
              distanceMeters: 12_500,
              duration: '1800s',
              polyline: { encodedPolyline: 'abc123' },
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;

    const result = await computeRoutes({
      projectId: 'p',
      origin: 'A',
      destination: 'B',
      fetchImpl,
    });

    expect(result).toEqual([
      { distanceKm: 12.5, durationS: 1800, fuelL: null, polylineEncoded: 'abc123' },
    ]);
  });

  it('con emissionType pide FUEL_CONSUMPTION y convierte microlitros a litros', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.vehicleInfo).toEqual({ emissionType: 'DIESEL' });
      expect(body.extraComputations).toContain('FUEL_CONSUMPTION');
      const fieldMask = (init?.headers as Record<string, string>)['X-Goog-FieldMask'];
      expect(fieldMask).toContain('fuelConsumptionMicroliters');
      return Promise.resolve(
        fakeResponse({
          ok: true,
          status: 200,
          json: {
            routes: [
              {
                distanceMeters: 5000,
                duration: '600s',
                polyline: { encodedPolyline: 'xyz' },
                travelAdvisory: { fuelConsumptionMicroliters: '2500000' },
              },
            ],
          },
        }),
      );
    }) as unknown as typeof fetch;

    const result = await computeRoutes({
      projectId: 'p',
      origin: 'A',
      destination: 'B',
      emissionType: 'DIESEL',
      fetchImpl,
    });

    expect(result[0]).toMatchObject({ distanceKm: 5, durationS: 600, fuelL: 2.5 });
  });

  it('devuelve [] cuando Routes API no encuentra rutas', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ ok: true, status: 200, json: {} }),
      ) as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'p', origin: 'A', destination: 'B', fetchImpl }),
    ).resolves.toEqual([]);
  });

  it('mapea un 400 a code invalid_request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ ok: false, status: 400, text: 'bad request' }),
      ) as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'p', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ name: 'RoutesApiError', code: 'invalid_request', httpStatus: 400 });
  });

  it('mapea un 401 a code auth_error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ ok: false, status: 401, text: 'unauthorized' }),
      ) as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'p', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ name: 'RoutesApiError', code: 'auth_error', httpStatus: 401 });
  });

  it('mapea un 429 a code quota_exceeded', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ ok: false, status: 429, text: 'rate limited' }),
      ) as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'p', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ name: 'RoutesApiError', code: 'quota_exceeded', httpStatus: 429 });
  });

  it('lanza auth_error si ADC falla al obtener el client', async () => {
    mockAuthThrows = true;
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'p', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ name: 'RoutesApiError', code: 'auth_error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lanza auth_error si ADC no devuelve token', async () => {
    mockToken = null;
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'p', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ name: 'RoutesApiError', code: 'auth_error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lanza network_error ante un fallo de red que no es abort', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    await expect(
      computeRoutes({ projectId: 'p', origin: 'A', destination: 'B', fetchImpl }),
    ).rejects.toMatchObject({ name: 'RoutesApiError', code: 'network_error' });
  });

  it('aborta y lanza RoutesApiError(code=timeout) si el fetch excede ROUTES_API_TIMEOUT_MS', async () => {
    vi.useFakeTimers();

    // fetch que solo termina cuando su AbortSignal se dispara (cuelga indefinido).
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
      })) as unknown as typeof fetch;

    const promise = computeRoutes({
      projectId: 'p',
      origin: 'A',
      destination: 'B',
      fetchImpl: hangingFetch,
    });

    // Adjuntamos la aserción antes de avanzar el reloj para no perder el reject.
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'RoutesApiError',
      code: 'timeout',
    });

    await vi.advanceTimersByTimeAsync(ROUTES_API_TIMEOUT_MS + 10);
    await assertion;
  });

  it('inyecta un AbortSignal en el fetch y no aborta si responde a tiempo', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(fakeResponse({ ok: true, status: 200, json: { routes: [] } }));
    }) as unknown as typeof fetch;

    const result = await computeRoutes({
      projectId: 'p',
      origin: 'A',
      destination: 'B',
      fetchImpl,
    });

    expect(result).toEqual([]);
  });
});
