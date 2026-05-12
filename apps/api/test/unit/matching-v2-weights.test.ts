import { DEFAULT_WEIGHTS_V2 } from '@booster-ai/matching-algorithm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import { resolveMatchingV2Weights } from '../../src/services/matching-v2-weights.js';

/**
 * Tests del parser defensivo de `MATCHING_V2_WEIGHTS_JSON` (ADR-033 §1).
 *
 * El parser tiene que tolerar TODOS los casos malformados sin crashear:
 * el matching engine NO puede caer porque alguien escribió JSON inválido
 * en una env var. Fallback a defaults conocidos + WARN structured log.
 */

const noop = (): void => undefined;
function makeLogger() {
  const warn = vi.fn();
  const logger = {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn,
    error: vi.fn(),
    fatal: noop,
    child: () => logger,
  } as never;
  return { logger, warn };
}

const ORIGINAL_JSON = appConfig.MATCHING_V2_WEIGHTS_JSON;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = ORIGINAL_JSON;
});

describe('resolveMatchingV2Weights', () => {
  it('empty string → defaults, sin warn (caso normal)', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = '';
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('whitespace-only → defaults, sin warn', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = '   ';
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('JSON válido + shape correcto + suma=1 → retorna parsed', () => {
    const valid = JSON.stringify({
      capacidad: 0.5,
      backhaul: 0.25,
      reputacion: 0.15,
      tier: 0.1,
    });
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = valid;
    const { logger, warn } = makeLogger();
    const result = resolveMatchingV2Weights(logger);
    expect(result).toEqual({
      capacidad: 0.5,
      backhaul: 0.25,
      reputacion: 0.15,
      tier: 0.1,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('JSON inválido (sintaxis) → defaults + warn', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON =
      '{invalid json,,';
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatch(/JSON inválido/);
  });

  it('shape incorrecto (campos faltantes) → defaults + warn', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = JSON.stringify({
      capacidad: 0.5,
      backhaul: 0.5,
    }); // faltan reputacion + tier
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatch(/shape inválido/);
  });

  it('valor negativo en campo → defaults + warn (shape inválido por min(0))', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = JSON.stringify({
      capacidad: -0.1,
      backhaul: 0.4,
      reputacion: 0.4,
      tier: 0.3,
    });
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('valor > 1 en campo → defaults + warn (max(1))', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = JSON.stringify({
      capacidad: 1.5,
      backhaul: 0,
      reputacion: 0,
      tier: 0,
    });
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('shape correcto pero suma ≠ 1 → defaults + warn (validateWeights falla)', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = JSON.stringify({
      capacidad: 0.5,
      backhaul: 0.5,
      reputacion: 0.5,
      tier: 0.5,
    });
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatch(/validación falló/);
  });

  it('tipos no-numéricos → defaults + warn', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = JSON.stringify({
      capacidad: '0.4',
      backhaul: '0.35',
      reputacion: '0.15',
      tier: '0.1',
    });
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('null como JSON → defaults + warn (no es object)', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON = 'null';
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('array como JSON → defaults + warn (no matchea object shape)', () => {
    (appConfig as { MATCHING_V2_WEIGHTS_JSON: string }).MATCHING_V2_WEIGHTS_JSON =
      '[0.4, 0.35, 0.15, 0.1]';
    const { logger, warn } = makeLogger();
    expect(resolveMatchingV2Weights(logger)).toEqual(DEFAULT_WEIGHTS_V2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
