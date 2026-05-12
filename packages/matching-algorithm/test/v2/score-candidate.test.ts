import { describe, expect, it } from 'vitest';
import {
  type CarrierCandidateV2,
  DEFAULT_WEIGHTS_V2,
  type TripScoringContextV2,
  scoreCandidateV2,
} from '../../src/v2/index.js';

/**
 * Tests de la función pura `scoreCandidateV2` (ADR-033).
 *
 * Cada test fija valores explícitos en lugar de derivarlos para
 * que la suite sirva de **contrato verificable** del scoring:
 * cualquier cambio futuro que rompa estos números requiere ADR
 * superseding.
 *
 * Cubre:
 *   - Cada componente individualmente (slack capacidad, backhaul, etc.).
 *   - Agregación con pesos default.
 *   - Pesos custom + validación.
 *   - Edge cases (cargoWeight 0, capacity 0, historial vacío, etc.).
 *   - Backhaul signal para observabilidad.
 */

function buildCandidate(overrides: Partial<CarrierCandidateV2> = {}): CarrierCandidateV2 {
  return {
    empresaId: 'emp-1',
    vehicleId: 'veh-1',
    vehicleCapacityKg: 10_000,
    tripActivoDestinoRegionMatch: false,
    tripsRecientes: { totalUltimos7d: 0, matchRegionalUltimos7d: 0 },
    ofertasUltimos90d: { totales: 0, aceptadas: 0 },
    tierBoost: 0,
    ...overrides,
  };
}

function buildTrip(overrides: Partial<TripScoringContextV2> = {}): TripScoringContextV2 {
  return {
    cargoWeightKg: 5_000,
    originRegionCode: 'XIII',
    ...overrides,
  };
}

describe('scoreCandidateV2 — componente capacidad', () => {
  it('cargoWeightKg=0 → s_capacidad=1 (sin info, no penaliza)', () => {
    const r = scoreCandidateV2(buildCandidate(), buildTrip({ cargoWeightKg: 0 }));
    expect(r.components.capacidad).toBe(1);
  });

  it('cargoWeightKg < 0 → s_capacidad=1 (defensa contra dato malformado)', () => {
    const r = scoreCandidateV2(buildCandidate(), buildTrip({ cargoWeightKg: -100 }));
    expect(r.components.capacidad).toBe(1);
  });

  it('match perfecto carga=capacidad → s_capacidad=1', () => {
    const r = scoreCandidateV2(
      buildCandidate({ vehicleCapacityKg: 5_000 }),
      buildTrip({ cargoWeightKg: 5_000 }),
    );
    expect(r.components.capacidad).toBe(1);
  });

  it('camión 2x → s_capacidad = 1 − 0.5×0.5 = 0.75', () => {
    const r = scoreCandidateV2(
      buildCandidate({ vehicleCapacityKg: 10_000 }),
      buildTrip({ cargoWeightKg: 5_000 }),
    );
    // slackRatio = (10000-5000)/10000 = 0.5
    // s_capacidad = 1 - 0.5 × 0.5 = 0.75
    expect(r.components.capacidad).toBeCloseTo(0.75, 5);
  });

  it('camión 10x → s_capacidad = 1 − 0.9×0.5 = 0.55', () => {
    const r = scoreCandidateV2(
      buildCandidate({ vehicleCapacityKg: 10_000 }),
      buildTrip({ cargoWeightKg: 1_000 }),
    );
    // slackRatio = 0.9; s = 1 - 0.45 = 0.55
    expect(r.components.capacidad).toBeCloseTo(0.55, 5);
  });

  it('capacity=0 (defensa) → s_capacidad=0', () => {
    const r = scoreCandidateV2(
      buildCandidate({ vehicleCapacityKg: 0 }),
      buildTrip({ cargoWeightKg: 5_000 }),
    );
    expect(r.components.capacidad).toBe(0);
  });

  it('cargo > capacity (no debería llegar acá) → s_capacidad=0', () => {
    const r = scoreCandidateV2(
      buildCandidate({ vehicleCapacityKg: 1_000 }),
      buildTrip({ cargoWeightKg: 5_000 }),
    );
    expect(r.components.capacidad).toBe(0);
  });
});

describe('scoreCandidateV2 — componente backhaul', () => {
  it('trip activo destino region match → s_backhaul=1, signal=active_trip_match', () => {
    const r = scoreCandidateV2(buildCandidate({ tripActivoDestinoRegionMatch: true }), buildTrip());
    expect(r.components.backhaul).toBe(1);
    expect(r.backhaulSignal).toBe('active_trip_match');
  });

  it('sin trip activo + histórico full match → s_backhaul=1, signal=recent_history_match', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        tripsRecientes: { totalUltimos7d: 3, matchRegionalUltimos7d: 3 },
      }),
      buildTrip(),
    );
    expect(r.components.backhaul).toBe(1);
    expect(r.backhaulSignal).toBe('recent_history_match');
  });

  it('histórico parcial → fracción + signal=recent_history_match', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        tripsRecientes: { totalUltimos7d: 4, matchRegionalUltimos7d: 1 },
      }),
      buildTrip(),
    );
    expect(r.components.backhaul).toBe(0.25);
    expect(r.backhaulSignal).toBe('recent_history_match');
  });

  it('sin trip activo + histórico vacío → s_backhaul=0, signal=no_signal', () => {
    const r = scoreCandidateV2(buildCandidate(), buildTrip());
    expect(r.components.backhaul).toBe(0);
    expect(r.backhaulSignal).toBe('no_signal');
  });

  it('histórico con matchRegional=0 → s_backhaul=0, signal=no_signal', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        tripsRecientes: { totalUltimos7d: 5, matchRegionalUltimos7d: 0 },
      }),
      buildTrip(),
    );
    expect(r.components.backhaul).toBe(0);
    expect(r.backhaulSignal).toBe('no_signal');
  });

  it('trip activo gana sobre histórico (orden de prioridad)', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        tripActivoDestinoRegionMatch: true,
        tripsRecientes: { totalUltimos7d: 10, matchRegionalUltimos7d: 1 },
      }),
      buildTrip(),
    );
    expect(r.components.backhaul).toBe(1);
    expect(r.backhaulSignal).toBe('active_trip_match');
  });

  it('división por cero protegida (totalUltimos7d=0, matchRegional=0)', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        tripsRecientes: { totalUltimos7d: 0, matchRegionalUltimos7d: 0 },
      }),
      buildTrip(),
    );
    expect(r.components.backhaul).toBe(0);
  });
});

describe('scoreCandidateV2 — componente reputación', () => {
  it('< 10 ofertas → floor 0.5 (onboarding-friendly)', () => {
    const r = scoreCandidateV2(
      buildCandidate({ ofertasUltimos90d: { totales: 5, aceptadas: 5 } }),
      buildTrip(),
    );
    expect(r.components.reputacion).toBe(0.5);
  });

  it('totales=0 → floor 0.5', () => {
    const r = scoreCandidateV2(
      buildCandidate({ ofertasUltimos90d: { totales: 0, aceptadas: 0 } }),
      buildTrip(),
    );
    expect(r.components.reputacion).toBe(0.5);
  });

  it('exactamente 10 ofertas → calcula tasa real (no floor)', () => {
    const r = scoreCandidateV2(
      buildCandidate({ ofertasUltimos90d: { totales: 10, aceptadas: 8 } }),
      buildTrip(),
    );
    expect(r.components.reputacion).toBe(0.8);
  });

  it('20 ofertas, 5 aceptadas → 0.25', () => {
    const r = scoreCandidateV2(
      buildCandidate({ ofertasUltimos90d: { totales: 20, aceptadas: 5 } }),
      buildTrip(),
    );
    expect(r.components.reputacion).toBe(0.25);
  });

  it('100 ofertas, 100 aceptadas → 1.0', () => {
    const r = scoreCandidateV2(
      buildCandidate({ ofertasUltimos90d: { totales: 100, aceptadas: 100 } }),
      buildTrip(),
    );
    expect(r.components.reputacion).toBe(1);
  });
});

describe('scoreCandidateV2 — componente tier', () => {
  it('tierBoost=0 (Free) → s_tier=0', () => {
    const r = scoreCandidateV2(buildCandidate({ tierBoost: 0 }), buildTrip());
    expect(r.components.tier).toBe(0);
  });

  it('tierBoost=0.30 (Standard) → s_tier=0.30', () => {
    const r = scoreCandidateV2(buildCandidate({ tierBoost: 0.3 }), buildTrip());
    expect(r.components.tier).toBe(0.3);
  });

  it('tierBoost=1.0 (Premium) → s_tier=1.0', () => {
    const r = scoreCandidateV2(buildCandidate({ tierBoost: 1 }), buildTrip());
    expect(r.components.tier).toBe(1);
  });

  it('tierBoost fuera de [0,1] → clamp', () => {
    const r1 = scoreCandidateV2(buildCandidate({ tierBoost: -0.5 }), buildTrip());
    expect(r1.components.tier).toBe(0);
    const r2 = scoreCandidateV2(buildCandidate({ tierBoost: 1.5 }), buildTrip());
    expect(r2.components.tier).toBe(1);
  });
});

describe('scoreCandidateV2 — agregación con pesos default', () => {
  it('todo en 0 → score=0 con desglose explícito', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        vehicleCapacityKg: 1,
        tripActivoDestinoRegionMatch: false,
        tripsRecientes: { totalUltimos7d: 0, matchRegionalUltimos7d: 0 },
        ofertasUltimos90d: { totales: 100, aceptadas: 0 }, // sin floor; tasa=0
        tierBoost: 0,
      }),
      buildTrip({ cargoWeightKg: 10_000 }), // cargo > capacity, s_capacidad=0
    );
    expect(r.score).toBe(0);
    expect(r.components).toEqual({
      capacidad: 0,
      backhaul: 0,
      reputacion: 0,
      tier: 0,
    });
  });

  it('todo en 1.0 → score=1.0', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        vehicleCapacityKg: 5_000,
        tripActivoDestinoRegionMatch: true,
        ofertasUltimos90d: { totales: 50, aceptadas: 50 },
        tierBoost: 1,
      }),
      buildTrip({ cargoWeightKg: 5_000 }),
    );
    expect(r.score).toBe(1);
  });

  it('candidato típico: capacidad 0.75 + backhaul 1 + reputación 0.5 + tier 0 → 0.55', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        vehicleCapacityKg: 10_000,
        tripActivoDestinoRegionMatch: true,
        // < 10 ofertas → floor 0.5
        ofertasUltimos90d: { totales: 0, aceptadas: 0 },
        tierBoost: 0,
      }),
      buildTrip({ cargoWeightKg: 5_000 }),
    );
    // 0.40×0.75 + 0.35×1 + 0.15×0.5 + 0.10×0 = 0.30 + 0.35 + 0.075 + 0 = 0.725
    expect(r.score).toBeCloseTo(0.725, 5);
  });

  it('carrier nuevo Premium con perfect-fit + sin backhaul → puntaje moderado', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        vehicleCapacityKg: 5_000,
        tripActivoDestinoRegionMatch: false,
        tripsRecientes: { totalUltimos7d: 0, matchRegionalUltimos7d: 0 },
        ofertasUltimos90d: { totales: 0, aceptadas: 0 },
        tierBoost: 1, // Premium
      }),
      buildTrip({ cargoWeightKg: 5_000 }),
    );
    // 0.40×1 + 0.35×0 + 0.15×0.5 + 0.10×1 = 0.40 + 0 + 0.075 + 0.10 = 0.575
    expect(r.score).toBeCloseTo(0.575, 5);
  });

  it('determinismo: mismo input → mismo output (3 calls)', () => {
    const c = buildCandidate({
      vehicleCapacityKg: 7_500,
      tripsRecientes: { totalUltimos7d: 5, matchRegionalUltimos7d: 2 },
      ofertasUltimos90d: { totales: 15, aceptadas: 9 },
      tierBoost: 0.6,
    });
    const t = buildTrip({ cargoWeightKg: 3_000 });
    const r1 = scoreCandidateV2(c, t);
    const r2 = scoreCandidateV2(c, t);
    const r3 = scoreCandidateV2(c, t);
    expect(r1.score).toBe(r2.score);
    expect(r2.score).toBe(r3.score);
    expect(r1.components).toEqual(r2.components);
  });
});

describe('scoreCandidateV2 — pesos custom', () => {
  it('pesos custom válidos se aplican', () => {
    const customWeights = {
      capacidad: 0.25,
      backhaul: 0.5,
      reputacion: 0.15,
      tier: 0.1,
    };
    const r = scoreCandidateV2(
      buildCandidate({
        vehicleCapacityKg: 5_000,
        tripActivoDestinoRegionMatch: true,
        ofertasUltimos90d: { totales: 0, aceptadas: 0 },
        tierBoost: 0.6,
      }),
      buildTrip({ cargoWeightKg: 5_000 }),
      customWeights,
    );
    // 0.25×1 + 0.50×1 + 0.15×0.5 + 0.10×0.6 = 0.25 + 0.50 + 0.075 + 0.06 = 0.885
    expect(r.score).toBeCloseTo(0.885, 5);
  });

  it('pesos que no suman 1.0 → Error', () => {
    expect(() =>
      scoreCandidateV2(buildCandidate(), buildTrip(), {
        capacidad: 0.5,
        backhaul: 0.5,
        reputacion: 0.5,
        tier: 0.5,
      }),
    ).toThrow(/suma=2\.0000/);
  });

  it('peso negativo → Error', () => {
    expect(() =>
      scoreCandidateV2(buildCandidate(), buildTrip(), {
        capacidad: -0.1,
        backhaul: 0.45,
        reputacion: 0.45,
        tier: 0.2,
      }),
    ).toThrow(/fuera de \[0, 1\]/);
  });

  it('peso >1 → Error', () => {
    expect(() =>
      scoreCandidateV2(buildCandidate(), buildTrip(), {
        capacidad: 1.5,
        backhaul: -0.3,
        reputacion: -0.1,
        tier: -0.1,
      }),
    ).toThrow();
  });

  it('pesos default suman 1.0 (invariante de DEFAULT_WEIGHTS_V2)', () => {
    const sum =
      DEFAULT_WEIGHTS_V2.capacidad +
      DEFAULT_WEIGHTS_V2.backhaul +
      DEFAULT_WEIGHTS_V2.reputacion +
      DEFAULT_WEIGHTS_V2.tier;
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('scoreCandidateV2 — robustez NaN / Infinity', () => {
  it('NaN en tripsRecientes → componente backhaul cae a 0 (no propaga NaN al score)', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        tripsRecientes: { totalUltimos7d: Number.NaN, matchRegionalUltimos7d: 1 },
      }),
      buildTrip(),
    );
    expect(r.components.backhaul).toBe(0);
    expect(r.score).not.toBeNaN();
  });

  it('score final siempre acotado a [0, 1]', () => {
    const candidates = [
      buildCandidate({ tierBoost: 10 }),
      buildCandidate({
        vehicleCapacityKg: 5_000,
        tripActivoDestinoRegionMatch: true,
        ofertasUltimos90d: { totales: 100, aceptadas: 99 },
        tierBoost: 1,
      }),
    ];
    for (const c of candidates) {
      const r = scoreCandidateV2(c, buildTrip({ cargoWeightKg: 5_000 }));
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});

describe('scoreCandidateV2 — passthrough de identifiers', () => {
  it('result preserva empresaId, vehicleId, vehicleCapacityKg', () => {
    const r = scoreCandidateV2(
      buildCandidate({
        empresaId: 'emp-custom',
        vehicleId: 'veh-custom',
        vehicleCapacityKg: 12_345,
      }),
      buildTrip(),
    );
    expect(r.empresaId).toBe('emp-custom');
    expect(r.vehicleId).toBe('veh-custom');
    expect(r.vehicleCapacityKg).toBe(12_345);
  });
});
