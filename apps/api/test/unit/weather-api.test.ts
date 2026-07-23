import { describe, expect, it, vi } from 'vitest';
import { WeatherApiError, obtenerClimaActual } from '../../src/services/weather-api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const base = {
  lat: -33.44,
  lng: -70.66,
  projectId: 'booster-ai-494222',
  getAccessToken: async () => 'fake-token',
};

describe('obtenerClimaActual — cliente Weather API (ADC)', () => {
  it('parsea temperature.degrees (°C)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ temperature: { degrees: 18.3, unit: 'CELSIUS' } }));
    const t = await obtenerClimaActual({ ...base, fetchImpl });
    expect(t).toBeCloseTo(18.3, 5);
    // ADC bearer + X-Goog-User-Project.
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer fake-token');
    expect(init.headers['X-Goog-User-Project']).toBe('booster-ai-494222');
  });

  it('HTTP no-2xx → WeatherApiError tipado', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 403));
    await expect(obtenerClimaActual({ ...base, fetchImpl })).rejects.toMatchObject({
      name: 'WeatherApiError',
      code: 'auth_error',
    });
  });

  it('respuesta sin temperature.degrees → error de parseo (invalid_response)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ weatherCondition: {} }));
    await expect(obtenerClimaActual({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      WeatherApiError,
    );
  });

  it('AbortError (timeout) → WeatherApiError code=timeout', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(obtenerClimaActual({ ...base, fetchImpl, timeoutMs: 10 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('token ADC ausente → auth_error', async () => {
    const fetchImpl = vi.fn();
    await expect(
      obtenerClimaActual({ ...base, getAccessToken: async () => null, fetchImpl }),
    ).rejects.toMatchObject({ code: 'auth_error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
