import { describe, expect, it } from 'vitest';
import {
  type CarrierCandidateV2,
  DEFAULT_TIER_BOOSTS,
  type TripScoringContextV2,
  scoreCandidateV2,
  selectTopNCandidatesV2,
  tierBoostFromSlug,
} from '../../src/v2/index.js';

/**
 * Tests de integración del flow completo v2 (ADR-033):
 *
 *   batch de candidatos crudos
 *     → mapear cada uno a CarrierCandidateV2
 *     → scoreCandidateV2 sobre cada uno
 *     → selectTopNCandidatesV2(N=5)
 *
 * Estos tests son los **vectores fijos del marketplace**: simulan
 * escenarios típicos (carrier local vs carrier remoto, premium vs free,
 * cold-start, etc.) y verifican que el orden resultante es el esperado
 * por producto/diseño.
 */

const TRIP_CONTEXT: TripScoringContextV2 = {
  cargoWeightKg: 5_000,
  originRegionCode: 'XIII',
};

interface ScenarioCarrier {
  id: string;
  vehicleCapacityKg: number;
  hasActiveTripDestinoRM: boolean;
  recentesTotal: number;
  recentesMatch: number;
  ofertasTotal: number;
  ofertasAceptadas: number;
  tierSlug: string;
}

function toCandidate(c: ScenarioCarrier): CarrierCandidateV2 {
  return {
    empresaId: `emp-${c.id}`,
    vehicleId: c.id,
    vehicleCapacityKg: c.vehicleCapacityKg,
    tripActivoDestinoRegionMatch: c.hasActiveTripDestinoRM,
    tripsRecientes: {
      totalUltimos7d: c.recentesTotal,
      matchRegionalUltimos7d: c.recentesMatch,
    },
    ofertasUltimos90d: {
      totales: c.ofertasTotal,
      aceptadas: c.ofertasAceptadas,
    },
    tierBoost: tierBoostFromSlug(c.tierSlug),
  };
}

describe('Integration: 5 carriers con perfiles distintos', () => {
  // Set fijo de carriers — el orden esperado refleja la visión de
  // producto: queremos que `local-premium-aceptador` salga primero.
  const SCENARIO: ScenarioCarrier[] = [
    {
      // Carrier #1: carrier local con trip activo terminando en la región del trip nuevo.
      // Premium tier, alta tasa aceptación. Capacity 6,000 (slack 17%).
      id: 'local-premium-aceptador',
      vehicleCapacityKg: 6_000,
      hasActiveTripDestinoRM: true,
      recentesTotal: 8,
      recentesMatch: 5,
      ofertasTotal: 40,
      ofertasAceptadas: 36,
      tierSlug: 'premium',
    },
    {
      // Carrier #2: trip activo NO matching, sin historial regional, free tier, baja aceptación.
      id: 'remoto-free-rechazador',
      vehicleCapacityKg: 15_000, // slack 67% — match pobre
      hasActiveTripDestinoRM: false,
      recentesTotal: 6,
      recentesMatch: 0,
      ofertasTotal: 30,
      ofertasAceptadas: 6, // 20%
      tierSlug: 'free',
    },
    {
      // Carrier #3: histórico parcial (3/5), pro tier, sin trip activo.
      id: 'medio-pro-historico',
      vehicleCapacityKg: 7_500,
      hasActiveTripDestinoRM: false,
      recentesTotal: 5,
      recentesMatch: 3, // 60% backhaul histórico
      ofertasTotal: 20,
      ofertasAceptadas: 14,
      tierSlug: 'pro',
    },
    {
      // Carrier #4: cold-start nuevo, standard tier, capacity perfect-fit.
      id: 'nuevo-standard',
      vehicleCapacityKg: 5_000,
      hasActiveTripDestinoRM: false,
      recentesTotal: 0,
      recentesMatch: 0,
      ofertasTotal: 0,
      ofertasAceptadas: 0,
      tierSlug: 'standard',
    },
    {
      // Carrier #5: gigante sin historial regional, free tier, alto rechazo.
      id: 'gigante-free-aspirante',
      vehicleCapacityKg: 30_000, // slack 83%
      hasActiveTripDestinoRM: false,
      recentesTotal: 10,
      recentesMatch: 1, // 10%
      ofertasTotal: 50,
      ofertasAceptadas: 25, // 50%
      tierSlug: 'free',
    },
  ];

  it('orden esperado: local-premium-aceptador es #1 con clear gap', () => {
    const scored = SCENARIO.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    const top = selectTopNCandidatesV2(scored, 5);
    expect(top[0]?.vehicleId).toBe('local-premium-aceptador');
  });

  it('orden esperado: medio-pro-historico es #2 (backhaul histórico + pro)', () => {
    const scored = SCENARIO.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    const top = selectTopNCandidatesV2(scored, 5);
    expect(top[1]?.vehicleId).toBe('medio-pro-historico');
  });

  it('orden esperado: nuevo-standard es #3 (perfect-fit + tier > carriers sin matching backhaul)', () => {
    const scored = SCENARIO.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    const top = selectTopNCandidatesV2(scored, 5);
    expect(top[2]?.vehicleId).toBe('nuevo-standard');
  });

  it('orden esperado: remoto-free-rechazador es #5 (último, peor en todos los factores)', () => {
    const scored = SCENARIO.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    const top = selectTopNCandidatesV2(scored, 5);
    expect(top[4]?.vehicleId).toBe('remoto-free-rechazador');
  });

  it('todos los 5 carriers califican (ninguno fue capado a 0)', () => {
    const scored = SCENARIO.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    expect(scored.every((s) => s.score > 0)).toBe(true);
  });

  it('top-3: corte preserva los 3 mejores por agregado', () => {
    const scored = SCENARIO.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    const top = selectTopNCandidatesV2(scored, 3);
    expect(top).toHaveLength(3);
    expect(top.map((x) => x.vehicleId)).toEqual([
      'local-premium-aceptador',
      'medio-pro-historico',
      'nuevo-standard',
    ]);
  });
});

describe('Integration: empate de scores entre carriers con backhaul activo', () => {
  it('mismo perfil exacto → tiebreak por vehicleId alfa', () => {
    const carriers: ScenarioCarrier[] = [
      {
        id: 'zzz-late',
        vehicleCapacityKg: 5_000,
        hasActiveTripDestinoRM: true,
        recentesTotal: 0,
        recentesMatch: 0,
        ofertasTotal: 20,
        ofertasAceptadas: 18,
        tierSlug: 'pro',
      },
      {
        id: 'aaa-early',
        vehicleCapacityKg: 5_000,
        hasActiveTripDestinoRM: true,
        recentesTotal: 0,
        recentesMatch: 0,
        ofertasTotal: 20,
        ofertasAceptadas: 18,
        tierSlug: 'pro',
      },
    ];
    const scored = carriers.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    const top = selectTopNCandidatesV2(scored, 2);
    // Mismo score → aaa-early gana por orden alfabético.
    expect(top[0]?.vehicleId).toBe('aaa-early');
    expect(top[1]?.vehicleId).toBe('zzz-late');
  });
});

describe('Integration: tierBoostFromSlug consistente con DEFAULT_TIER_BOOSTS', () => {
  it('mapping cubre los 4 tiers', () => {
    expect(tierBoostFromSlug('free')).toBe(DEFAULT_TIER_BOOSTS.free);
    expect(tierBoostFromSlug('standard')).toBe(DEFAULT_TIER_BOOSTS.standard);
    expect(tierBoostFromSlug('pro')).toBe(DEFAULT_TIER_BOOSTS.pro);
    expect(tierBoostFromSlug('premium')).toBe(DEFAULT_TIER_BOOSTS.premium);
  });

  it('slug desconocido → 0 (free baseline)', () => {
    expect(tierBoostFromSlug('enterprise-custom')).toBe(0);
  });

  it('null → 0', () => {
    expect(tierBoostFromSlug(null)).toBe(0);
  });

  it('undefined → 0', () => {
    expect(tierBoostFromSlug(undefined)).toBe(0);
  });

  it('string vacío → 0', () => {
    expect(tierBoostFromSlug('')).toBe(0);
  });
});

describe('Integration: backhaul signals correctos en mix de carriers', () => {
  it('cada uno reporta su signal correcto', () => {
    const carriers: ScenarioCarrier[] = [
      {
        id: 'a',
        vehicleCapacityKg: 5_000,
        hasActiveTripDestinoRM: true,
        recentesTotal: 0,
        recentesMatch: 0,
        ofertasTotal: 0,
        ofertasAceptadas: 0,
        tierSlug: 'free',
      },
      {
        id: 'b',
        vehicleCapacityKg: 5_000,
        hasActiveTripDestinoRM: false,
        recentesTotal: 3,
        recentesMatch: 2,
        ofertasTotal: 0,
        ofertasAceptadas: 0,
        tierSlug: 'free',
      },
      {
        id: 'c',
        vehicleCapacityKg: 5_000,
        hasActiveTripDestinoRM: false,
        recentesTotal: 0,
        recentesMatch: 0,
        ofertasTotal: 0,
        ofertasAceptadas: 0,
        tierSlug: 'free',
      },
    ];
    const scored = carriers.map((c) => scoreCandidateV2(toCandidate(c), TRIP_CONTEXT));
    expect(scored.find((s) => s.vehicleId === 'a')?.backhaulSignal).toBe('active_trip_match');
    expect(scored.find((s) => s.vehicleId === 'b')?.backhaulSignal).toBe('recent_history_match');
    expect(scored.find((s) => s.vehicleId === 'c')?.backhaulSignal).toBe('no_signal');
  });
});

describe('Integration: gaming attempt — carrier no puede inflar su score', () => {
  it('inflar tierBoost por encima de 1 → clamp a 1, no rompe agregación', () => {
    const c = toCandidate({
      id: 'gamer',
      vehicleCapacityKg: 5_000,
      hasActiveTripDestinoRM: false,
      recentesTotal: 0,
      recentesMatch: 0,
      ofertasTotal: 0,
      ofertasAceptadas: 0,
      tierSlug: 'free',
    });
    c.tierBoost = 9999; // intento de gaming
    const r = scoreCandidateV2(c, TRIP_CONTEXT);
    // tier component clamped a 1; resto neutro/0.
    // 0.40×1 + 0.35×0 + 0.15×0.5 + 0.10×1 = 0.40 + 0 + 0.075 + 0.10 = 0.575
    expect(r.score).toBeCloseTo(0.575, 5);
  });

  it('inflar matchRegional > totalUltimos7d → clamp (no >1)', () => {
    const c = toCandidate({
      id: 'gamer',
      vehicleCapacityKg: 5_000,
      hasActiveTripDestinoRM: false,
      recentesTotal: 2,
      recentesMatch: 10, // > total, intento de gaming
      ofertasTotal: 0,
      ofertasAceptadas: 0,
      tierSlug: 'free',
    });
    const r = scoreCandidateV2(c, TRIP_CONTEXT);
    expect(r.components.backhaul).toBe(1); // clamped a 1
  });
});
