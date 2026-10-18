import type { Logger } from '@booster-ai/logger';
import { DEFAULT_WEIGHTS_V2, rankearCandidatos } from '@booster-ai/matching-algorithm';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from './app.js';

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

const v1 = {
  algoritmo: 'v1',
  cargoWeightKg: 9000,
  maxOfertas: 5,
  candidatos: [
    { empresaId: E1, vehicleId: V1, vehicleCapacityKg: 30000 },
    { empresaId: E2, vehicleId: V2, vehicleCapacityKg: 10000 },
  ],
} as const;

const candidatoV2 = (empresaId: string, vehicleId: string, backhaul: boolean) => ({
  empresaId,
  vehicleId,
  vehicleCapacityKg: 12000,
  tripActivoDestinoRegionMatch: backhaul,
  tripsRecientes: { totalUltimos7d: 0, matchRegionalUltimos7d: 0 },
  ofertasUltimos90d: { totales: 0, aceptadas: 0 },
  tierBoost: 0,
});

function setup(verificado = true) {
  const log = makeLogger();
  const verificarToken = vi.fn(async (header: string | undefined) =>
    verificado && header === 'Bearer ok' ? { ok: true as const } : { ok: false as const },
  );
  const app = crearApp({ logger: log as never as Logger, verificarToken });
  const post = (body: unknown, auth = 'Bearer ok') =>
    app.request('/ranking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, log, post, verificarToken };
}

describe('matching-engine app', () => {
  it('GET /health sin auth', async () => {
    const res = await setup().app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'matching-engine' });
  });

  it('POST /ranking v1 devuelve exactamente el ranking de @booster-ai/matching-algorithm', async () => {
    const res = await setup().post(v1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rankearCandidatos(v1));
  });

  it('POST /ranking v2 con desglose', async () => {
    const solicitud = {
      algoritmo: 'v2',
      cargoWeightKg: 9000,
      originRegionCode: 'XIII',
      maxOfertas: 5,
      pesos: DEFAULT_WEIGHTS_V2,
      candidatos: [candidatoV2(E1, V1, false), candidatoV2(E2, V2, true)],
    } as const;
    const { post, log } = setup();
    const res = await post(solicitud);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { top: { empresaId: string }[] };
    expect(body).toEqual(rankearCandidatos(solicitud));
    expect(body.top[0]?.empresaId).toBe(E2);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ algoritmo: 'v2', candidatos: 2, ofertas: 2 }),
      'ranking calculado',
    );
  });

  it('sin token válido → 401 y no rankea', async () => {
    const { post } = setup(false);
    const res = await post(v1, 'Bearer malo');
    expect(res.status).toBe(401);
  });

  it('body no JSON o fuera de contrato → 400', async () => {
    const { post } = setup();
    expect((await post('{x')).status).toBe(400);
    expect((await post({ ...v1, algoritmo: 'v9' })).status).toBe(400);
  });

  it('pesos v2 inválidos (no suman 1) → 422 con el error del algoritmo', async () => {
    const { post, log } = setup();
    const res = await post({
      algoritmo: 'v2',
      cargoWeightKg: 1,
      originRegionCode: 'XIII',
      maxOfertas: 5,
      pesos: { capacidad: 1, backhaul: 1, reputacion: 0, tier: 0 },
      candidatos: [candidatoV2(E1, V1, false)],
    });
    expect(res.status).toBe(422);
    expect(log.warn).toHaveBeenCalled();
  });
});
