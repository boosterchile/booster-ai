import type { Logger } from '@booster-ai/logger';
import {
  type ResultadoRanking,
  type SolicitudRanking,
  hashRanking,
  rankearCandidatos,
} from '@booster-ai/matching-algorithm';
import { describe, expect, it, vi } from 'vitest';
import {
  crearClienteMatchingEngine,
  crearRankeadorMatching,
  modoMatching,
} from './matching-ranking.js';

const noop = (): void => undefined;
function makeLogger() {
  return {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => makeLogger(),
  };
}

const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const V1 = '00000000-0000-4000-8000-0000000000a1';
const V2 = '00000000-0000-4000-8000-0000000000a2';

const solicitud: SolicitudRanking = {
  algoritmo: 'v1',
  cargoWeightKg: 9_000,
  maxOfertas: 5,
  candidatos: [
    { empresaId: E1, vehicleId: V1, vehicleCapacityKg: 30_000 },
    { empresaId: E2, vehicleId: V2, vehicleCapacityKg: 10_000 },
  ],
};
const local = rankearCandidatos(solicitud);

function setup() {
  const log = makeLogger();
  const remoto = vi.fn(async (_s: SolicitudRanking): Promise<ResultadoRanking> => local);
  return { log, logger: log as never as Logger, remoto };
}

/** Espera a que se resuelvan los microtasks del fire-and-forget. */
const drenar = () => new Promise((r) => setTimeout(r, 0));

describe('modoMatching', () => {
  it('microservicio gana sobre sombra; ambos off es local', () => {
    expect(modoMatching({ viaMicroservicio: false, sombra: false })).toBe('local');
    expect(modoMatching({ viaMicroservicio: false, sombra: true })).toBe('sombra');
    expect(modoMatching({ viaMicroservicio: true, sombra: true })).toBe('microservicio');
  });
});

describe('crearRankeadorMatching', () => {
  it('local: rankea en proceso, sin tocar el remoto, y trasCommit no hace nada', async () => {
    const { logger, remoto } = setup();
    const r = crearRankeadorMatching({ modo: 'local', remoto, logger });
    await expect(r.rankear(solicitud)).resolves.toEqual(local);
    r.trasCommit(solicitud, local);
    await drenar();
    expect(remoto).not.toHaveBeenCalled();
  });

  it('sin remoto configurado, cualquier modo degrada a local con warn', async () => {
    const { logger, log, remoto } = setup();
    const r = crearRankeadorMatching({ modo: 'microservicio', remoto: null, logger });
    await expect(r.rankear(solicitud)).resolves.toEqual(local);
    expect(log.warn).toHaveBeenCalled();
    expect(remoto).not.toHaveBeenCalled();
  });

  it('sombra: decide local y, tras el commit, compara con el remoto (coincide)', async () => {
    const { logger, log, remoto } = setup();
    const r = crearRankeadorMatching({ modo: 'sombra', remoto, logger });

    await expect(r.rankear(solicitud)).resolves.toEqual(local);
    expect(remoto).not.toHaveBeenCalled();

    r.trasCommit(solicitud, local);
    await drenar();
    expect(remoto).toHaveBeenCalledWith(solicitud);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ hash: hashRanking(local.top) }),
      'matching sombra coincide',
    );
  });

  it('sombra: ranking remoto distinto → warn con ambos hashes', async () => {
    const { logger, log, remoto } = setup();
    const distinto: ResultadoRanking = { ...local, top: [...local.top].reverse() };
    remoto.mockResolvedValueOnce(distinto);
    const r = crearRankeadorMatching({ modo: 'sombra', remoto, logger });

    r.trasCommit(solicitud, local);
    await drenar();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        hashLocal: hashRanking(local.top),
        hashRemoto: hashRanking(distinto.top),
      }),
      'matching sombra diverge',
    );
  });

  it('sombra: error del remoto se loguea y no lanza', async () => {
    const { logger, log, remoto } = setup();
    remoto.mockRejectedValueOnce(new Error('503'));
    const r = crearRankeadorMatching({ modo: 'sombra', remoto, logger });

    expect(() => r.trasCommit(solicitud, local)).not.toThrow();
    await drenar();
    expect(log.error).toHaveBeenCalledWith(expect.anything(), 'matching sombra error');
  });

  it('microservicio: usa el ranking remoto', async () => {
    const { logger, log, remoto } = setup();
    const r = crearRankeadorMatching({ modo: 'microservicio', remoto, logger });
    await expect(r.rankear(solicitud)).resolves.toEqual(local);
    expect(remoto).toHaveBeenCalledWith(solicitud);
    expect(log.info).toHaveBeenCalledWith(expect.anything(), 'matching ranking remoto');
  });

  it('microservicio: remoto que falla → fallback local con error logueado', async () => {
    const { logger, log, remoto } = setup();
    remoto.mockRejectedValueOnce(new Error('timeout'));
    const r = crearRankeadorMatching({ modo: 'microservicio', remoto, logger });
    await expect(r.rankear(solicitud)).resolves.toEqual(local);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'matching remoto fallo, fallback local',
    );
  });

  it('microservicio: ranking remoto con un vehículo que no estaba entre los candidatos → fallback', async () => {
    const { logger, log, remoto } = setup();
    remoto.mockResolvedValueOnce({
      ...local,
      top: [{ ...local.top[0], vehicleId: '00000000-0000-4000-8000-0000000000ff' } as never],
    });
    const r = crearRankeadorMatching({ modo: 'microservicio', remoto, logger });
    await expect(r.rankear(solicitud)).resolves.toEqual(local);
    expect(log.error).toHaveBeenCalledWith(
      expect.anything(),
      'matching remoto fallo, fallback local',
    );
  });

  it('microservicio: trasCommit no hace nada', async () => {
    const { logger, remoto } = setup();
    const r = crearRankeadorMatching({ modo: 'microservicio', remoto, logger });
    r.trasCommit(solicitud, local);
    await drenar();
    expect(remoto).not.toHaveBeenCalled();
  });
});

describe('crearClienteMatchingEngine', () => {
  const URL = 'https://booster-ai-matching-engine-123.southamerica-west1.run.app';

  function cliente(respuesta: { status: number; data: unknown }) {
    const request = vi.fn().mockResolvedValue(respuesta);
    const obtenerCliente = vi.fn().mockResolvedValue({ request });
    return {
      request,
      obtenerCliente,
      rankear: crearClienteMatchingEngine({ url: URL, obtenerCliente }),
    };
  }

  it('POST /ranking con la solicitud, timeout 3 s, y valida la respuesta con el contrato', async () => {
    const { request, obtenerCliente, rankear } = cliente({ status: 200, data: local });
    await expect(rankear(solicitud)).resolves.toEqual(local);
    expect(obtenerCliente).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith({
      url: `${URL}/ranking`,
      method: 'POST',
      data: solicitud,
      timeout: 3_000,
      headers: { 'content-type': 'application/json' },
    });
  });

  it('status no 200 o respuesta fuera de contrato → lanza', async () => {
    await expect(cliente({ status: 500, data: {} }).rankear(solicitud)).rejects.toThrow('500');
    await expect(
      cliente({ status: 200, data: { algoritmo: 'v9' } }).rankear(solicitud),
    ).rejects.toThrow();
  });

  it('por defecto obtiene un ID token client de google-auth-library para la URL', async () => {
    const getIdTokenClient = vi.fn().mockResolvedValue({
      request: vi.fn().mockResolvedValue({ status: 200, data: local }),
    });
    vi.resetModules();
    vi.doMock('google-auth-library', () => ({
      GoogleAuth: vi.fn(function GoogleAuthMock() {
        return { getIdTokenClient };
      }),
    }));
    const mod = await import('./matching-ranking.js');
    await expect(mod.crearClienteMatchingEngine({ url: URL })(solicitud)).resolves.toEqual(local);
    expect(getIdTokenClient).toHaveBeenCalledWith(URL);
    vi.doUnmock('google-auth-library');
  });
});
