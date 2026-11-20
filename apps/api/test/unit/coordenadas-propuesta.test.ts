import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const computeRoutesMock = vi.fn();
vi.mock('../../src/services/routes-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/routes-api.js')>();
  return { ...actual, computeRoutes: (...a: unknown[]) => computeRoutesMock(...a) };
});

const { completarCoordenadasPropuesta } = await import(
  '../../src/services/coordenadas-propuesta.js'
);

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const VIAJE = {
  originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
  originRegionCode: 'XIII',
  originComunaCode: '13114',
  originLatitude: '-33.4100000',
  originLongitude: '-70.5800000',
  destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
  destinationRegionCode: 'V',
  destinationComunaCode: null,
  destinationLatitude: '-33.0200000',
  destinationLongitude: '-71.5500000',
};

function db(viaje: typeof VIAJE | null = VIAJE) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => (viaje ? [viaje] : []));
  return { select: vi.fn(() => chain) } as never;
}

const deps = (d = db()) => ({ db: d, logger, routesProjectId: 'proj' });
const opts = (cambios: object) => ({ tripId: 'trip-1', empresaId: 'emp-1', cambios });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('completarCoordenadasPropuesta (editar-anular-cargas §6.3)', () => {
  it('sin origen ni destino no consulta nada', async () => {
    const d = db();
    expect(await completarCoordenadasPropuesta(deps(d), opts({ weight_kg: 2000 }))).toEqual({
      weight_kg: 2000,
    });
    expect(computeRoutesMock).not.toHaveBeenCalled();
  });

  it('la misma dirección sin coordenadas hereda las actuales (no es un cambio ni las borra)', async () => {
    const r = await completarCoordenadasPropuesta(
      deps(),
      opts({
        origin: {
          address_raw: 'Av. Apoquindo 4500, Las Condes',
          region_code: 'XIII',
          comuna_code: '13114',
        },
      }),
    );
    expect(r).toEqual({
      origin: {
        address_raw: 'Av. Apoquindo 4500, Las Condes',
        region_code: 'XIII',
        comuna_code: '13114',
        latitude: -33.41,
        longitude: -70.58,
      },
    });
    expect(computeRoutesMock).not.toHaveBeenCalled();
  });

  it('una dirección nueva sin coordenadas se geocodifica con Routes (origen y destino en una llamada)', async () => {
    computeRoutesMock.mockResolvedValue([
      { startLocation: { lat: -33.39, lng: -70.79 }, endLocation: { lat: -33.59, lng: -71.61 } },
    ]);
    const r = await completarCoordenadasPropuesta(
      deps(),
      opts({
        origin: { address_raw: 'Camino Lo Boza 120, Pudahuel', region_code: 'XIII' },
        destination: { address_raw: 'Puerto de San Antonio', region_code: 'V' },
      }),
    );
    expect(computeRoutesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj',
        origin: 'Camino Lo Boza 120, Pudahuel',
        destination: 'Puerto de San Antonio',
      }),
    );
    expect(r).toMatchObject({
      origin: { latitude: -33.39, longitude: -70.79 },
      destination: { latitude: -33.59, longitude: -71.61 },
    });
  });

  it('si solo cambia el destino, la ruta usa el origen actual y solo completa el destino', async () => {
    computeRoutesMock.mockResolvedValue([
      { startLocation: { lat: -33.41, lng: -70.58 }, endLocation: { lat: -33.59, lng: -71.61 } },
    ]);
    const r = await completarCoordenadasPropuesta(
      deps(),
      opts({ destination: { address_raw: 'Puerto de San Antonio', region_code: 'V' } }),
    );
    expect(computeRoutesMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'Av. Apoquindo 4500, Las Condes' }),
    );
    expect(r).toEqual({
      destination: {
        address_raw: 'Puerto de San Antonio',
        region_code: 'V',
        latitude: -33.59,
        longitude: -71.61,
      },
    });
  });

  it('las coordenadas que trae el cliente se respetan', async () => {
    const origin = {
      address_raw: 'Camino Lo Boza 120, Pudahuel',
      region_code: 'XIII',
      latitude: -33.39,
      longitude: -70.79,
    };
    expect(await completarCoordenadasPropuesta(deps(), opts({ origin }))).toEqual({ origin });
    expect(computeRoutesMock).not.toHaveBeenCalled();
  });

  it('si Routes falla o no hay proyecto, la propuesta sigue sin coordenadas', async () => {
    computeRoutesMock.mockRejectedValueOnce(new Error('timeout'));
    const origin = { address_raw: 'Camino Lo Boza 120, Pudahuel', region_code: 'XIII' };
    expect(await completarCoordenadasPropuesta(deps(), opts({ origin }))).toEqual({ origin });
    expect(
      await completarCoordenadasPropuesta(
        { db: db(), logger, routesProjectId: undefined },
        opts({ origin }),
      ),
    ).toEqual({ origin });
  });
});
