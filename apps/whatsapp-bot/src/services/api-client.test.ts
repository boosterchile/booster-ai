import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as unknown as ConstructorParameters<typeof ApiClient>[0]['logger'];

const requestMock = vi.fn();
const getIdTokenClientMock = vi.fn(async () => ({ request: requestMock }));

vi.mock('google-auth-library', () => ({
  GoogleAuth: class GoogleAuthStub {
    getIdTokenClient = getIdTokenClientMock;
  },
}));

const VALID_INPUT = {
  shipper_whatsapp: '+56912345678',
  origin_address_raw: 'Av. Quilín 1234, Santiago',
  destination_address_raw: 'Puerto de Valparaíso',
  cargo_type: 'carga_seca' as const,
  pickup_date_raw: 'mañana por la mañana',
};

describe('ApiClient.createTripRequest', () => {
  let client: ApiClient;

  beforeEach(() => {
    requestMock.mockReset();
    getIdTokenClientMock.mockClear();
    client = new ApiClient({
      apiUrl: 'https://api.example.com',
      audience: 'https://api.example.com',
      logger: noopLogger,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('201 retorna { tracking_code, id }', async () => {
    requestMock.mockResolvedValueOnce({
      status: 201,
      data: { tracking_code: 'TR-123', id: 'uuid-1' },
    });

    const result = await client.createTripRequest(VALID_INPUT);

    expect(result).toEqual({ tracking_code: 'TR-123', id: 'uuid-1' });
    expect(getIdTokenClientMock).toHaveBeenCalledWith('https://api.example.com');
    expect(requestMock).toHaveBeenCalledWith({
      url: 'https://api.example.com/trip-requests',
      method: 'POST',
      data: VALID_INPUT,
      headers: { 'content-type': 'application/json' },
    });
  });

  it('status distinto a 201 lanza Error y loggea', async () => {
    requestMock.mockResolvedValueOnce({ status: 500, data: { error: 'boom' } });

    await expect(client.createTripRequest(VALID_INPUT)).rejects.toThrow('returned 500');
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500 }),
      'api.createTripRequest unexpected status',
    );
  });

  it('si la request lanza, propaga el error sin transformar', async () => {
    requestMock.mockRejectedValueOnce(new Error('network down'));
    await expect(client.createTripRequest(VALID_INPUT)).rejects.toThrow('network down');
  });
});
