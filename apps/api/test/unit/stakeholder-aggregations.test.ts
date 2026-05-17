import { describe, expect, it, vi } from 'vitest';
import {
  type ViajeAgregable,
  agregarPorCombustible,
  agregarPorHoraDelDia,
  agregarPorTipoCarga,
  aplicarKAnonymityHorario,
  aplicarKAnonymityQuasiId,
  calcularHorarioPico,
  resolveCo2e,
} from '../../src/services/stakeholder-aggregations.js';

interface MkOptions {
  actual?: number | null;
  estimated?: number | null;
  tipoCarga?: string;
  fuelType?: string;
}

const mk = (
  iso: string,
  actualOrOpts?: number | null | MkOptions,
  estimated?: number | null,
): ViajeAgregable => {
  const opts: MkOptions =
    typeof actualOrOpts === 'object' && actualOrOpts !== null
      ? actualOrOpts
      : { actual: actualOrOpts, estimated };
  return {
    pickupWindowStart: new Date(iso),
    carbonEmissionsKgco2eActual: opts.actual ?? null,
    carbonEmissionsKgco2eEstimated: opts.estimated ?? null,
    tipoCarga: opts.tipoCarga ?? 'carga_seca',
    fuelType: opts.fuelType ?? 'diesel',
  };
};
const repeat = (n: number, fn: () => ViajeAgregable) => Array.from({ length: n }, fn);

describe('resolveCo2e', () => {
  it('prioriza CO2e actual sobre estimated', () => {
    expect(resolveCo2e(mk('2026-05-17T10:00:00Z', 100, 80))).toBe(100);
  });

  it('fallback a estimated cuando actual es null', () => {
    expect(resolveCo2e(mk('2026-05-17T10:00:00Z', null, 80))).toBe(80);
  });

  it('null + warn cuando ambos son null', () => {
    const warn = vi.fn();
    const logger = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
    expect(resolveCo2e(mk('2026-05-17T10:00:00Z', null, null), logger)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('agregarPorHoraDelDia', () => {
  it('cero viajes → 24 entries con viajes=0 y co2e=0', () => {
    const r = agregarPorHoraDelDia([]);
    expect(r).toHaveLength(24);
    expect(r.every((b, i) => b.hora === i && b.viajes === 0 && b.co2e_kg === 0)).toBe(true);
  });

  it('exactamente k=5 a la misma hora suma CO2e usando actual', () => {
    const r = agregarPorHoraDelDia(repeat(5, () => mk('2026-05-17T10:00:00Z', 50)));
    expect(r[6]).toEqual({ hora: 6, viajes: 5, co2e_kg: 250 }); // 10 UTC = 6 CL
  });

  it('k+1: fallback estimated cuando actual null + warn cuando ambos null', () => {
    const warn = vi.fn();
    const logger = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
    const viajes = [
      ...repeat(5, () => mk('2026-05-17T10:00:00Z', 50)),
      mk('2026-05-17T10:00:00Z', null, 40),
      mk('2026-05-17T10:00:00Z'),
    ];
    expect(agregarPorHoraDelDia(viajes, logger)[6]).toEqual({ hora: 6, viajes: 7, co2e_kg: 290 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('distribución bimodal: dos picos en horas distintas', () => {
    const viajes = [
      ...repeat(3, () => mk('2026-05-17T12:00:00Z', 30)),
      ...repeat(3, () => mk('2026-05-17T22:00:00Z', 30)),
    ];
    const r = agregarPorHoraDelDia(viajes);
    expect(r[8].viajes).toBe(3); // 12 UTC = 8 CL
    expect(r[18].viajes).toBe(3); // 22 UTC = 18 CL
  });
});

describe('aplicarKAnonymityHorario', () => {
  it('preserva buckets con count >= 5, enmascara los demás manteniendo hora', () => {
    const buckets = [
      { hora: 8, viajes: 6, co2e_kg: 120 },
      { hora: 9, viajes: 3, co2e_kg: 60 },
      { hora: 10, viajes: 0, co2e_kg: 0 },
    ];
    const r = aplicarKAnonymityHorario(buckets);
    expect(r[0]).toEqual({ hora: 8, viajes: 6, co2e_kg: 120 });
    expect(r[1]).toEqual({ hora: 9, viajes: null, co2e_kg: null });
    expect(r[2]).toEqual({ hora: 10, viajes: null, co2e_kg: null });
  });

  it('siempre devuelve 24 buckets (no filtra) para preservar universo cerrado', () => {
    const buckets = Array.from({ length: 24 }, (_, hora) => ({ hora, viajes: 0, co2e_kg: 0 }));
    expect(aplicarKAnonymityHorario(buckets)).toHaveLength(24);
  });
});

describe('calcularHorarioPico', () => {
  it('null cuando <5 viajes (k-anonymity dataset)', () => {
    expect(calcularHorarioPico(repeat(4, () => mk('2026-05-17T12:00:00Z')))).toBeNull();
  });

  it('5 viajes concentrados a 8 CL → ventana 5..8 más temprana', () => {
    const r = calcularHorarioPico(repeat(5, () => mk('2026-05-17T12:00:00Z')));
    expect(r).toEqual({ inicio: 5, fin: 8 });
  });

  it('null cuando 5 viajes distribuidos uno-por-hora (ventana ganadora <k)', () => {
    const viajes = [
      mk('2026-05-17T12:00:00Z'), // 8 CL
      mk('2026-05-17T20:00:00Z'), // 16 CL
      mk('2026-05-17T03:00:00Z'), // 23 CL ayer / 0 CL ?
      mk('2026-05-17T15:00:00Z'), // 11 CL
      mk('2026-05-17T18:00:00Z'), // 14 CL
    ];
    // total 5 → pasa el guard dataset. Pero la ventana máxima de 4h sólo
    // captura 1-2 viajes → ventana ganadora < k → null.
    expect(calcularHorarioPico(viajes)).toBeNull();
  });

  it('pico claro vs ruido', () => {
    const viajes = [
      ...repeat(6, () => mk('2026-05-17T12:00:00Z')), // 8 CL × 6 → ventana 5..8 = 6 ≥ k
      ...repeat(2, () => mk('2026-05-17T02:00:00Z')), // 22 CL × 2 — fuera de rango [0..20]
    ];
    expect(calcularHorarioPico(viajes)).toEqual({ inicio: 5, fin: 8 });
  });

  it('bimodal: dos picos genuinos separados >4h → toma el primero', () => {
    const viajes = [
      ...repeat(6, () => mk('2026-05-17T11:00:00Z')), // 7 CL × 6 → ventana 4..7 = 6
      ...repeat(6, () => mk('2026-05-17T22:00:00Z')), // 18 CL × 6 → ventana 15..18 = 6
    ];
    // Ambas ventanas tienen 6 ≥ k. Empate → más temprana = inicio 4.
    expect(calcularHorarioPico(viajes)).toEqual({ inicio: 4, fin: 7 });
  });

  it('bimodal asimétrica: pico tarde supera pico mañana', () => {
    const viajes = [
      ...repeat(5, () => mk('2026-05-17T11:00:00Z')), // 7 CL × 5
      ...repeat(7, () => mk('2026-05-17T22:00:00Z')), // 18 CL × 7
    ];
    // Ventana 15..18 tiene 7 viajes (> 5). Gana sobre ventana 4..7 (5 viajes).
    expect(calcularHorarioPico(viajes)).toEqual({ inicio: 15, fin: 18 });
  });
});

describe('agregarPorTipoCarga', () => {
  it('agrupa por tipo y suma CO2e (CARGA_SECA + GNV)', () => {
    const viajes = [
      ...repeat(3, () => mk('2026-05-17T10:00:00Z', { actual: 100, tipoCarga: 'carga_seca' })),
      ...repeat(2, () => mk('2026-05-17T10:00:00Z', { actual: 50, tipoCarga: 'refrigerada' })),
    ];
    const r = agregarPorTipoCarga(viajes);
    expect(r.find((b) => b.tipo === 'carga_seca')).toEqual({
      tipo: 'carga_seca',
      viajes: 3,
      co2e_kg: 300,
    });
    expect(r.find((b) => b.tipo === 'refrigerada')).toEqual({
      tipo: 'refrigerada',
      viajes: 2,
      co2e_kg: 100,
    });
  });

  it('viaje sin CO2e cuenta en viajes pero no en co2e_kg (decisión PO)', () => {
    const warn = vi.fn();
    const logger = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
    const viajes = [
      mk('2026-05-17T10:00:00Z', { actual: 100, tipoCarga: 'carga_seca' }),
      mk('2026-05-17T10:00:00Z', { actual: null, estimated: null, tipoCarga: 'carga_seca' }),
    ];
    const r = agregarPorTipoCarga(viajes, logger);
    expect(r[0]).toEqual({ tipo: 'carga_seca', viajes: 2, co2e_kg: 100 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('fallback actual → estimated', () => {
    const viajes = [
      mk('2026-05-17T10:00:00Z', { actual: null, estimated: 80, tipoCarga: 'carga_seca' }),
    ];
    expect(agregarPorTipoCarga(viajes)[0]?.co2e_kg).toBe(80);
  });
});

describe('agregarPorCombustible', () => {
  it('agrupa por fuel_type y suma CO2e (diesel + electrico)', () => {
    const viajes = [
      ...repeat(3, () => mk('2026-05-17T10:00:00Z', { actual: 100, fuelType: 'diesel' })),
      ...repeat(2, () => mk('2026-05-17T10:00:00Z', { actual: 5, fuelType: 'electrico' })),
    ];
    const r = agregarPorCombustible(viajes);
    expect(r.find((b) => b.fuel_type === 'diesel')).toEqual({
      fuel_type: 'diesel',
      viajes: 3,
      co2e_kg: 300,
    });
    expect(r.find((b) => b.fuel_type === 'electrico')).toEqual({
      fuel_type: 'electrico',
      viajes: 2,
      co2e_kg: 10,
    });
  });
});

describe('aplicarKAnonymityQuasiId (ADR-042 §6 nivel 3)', () => {
  it('filtra (drop) buckets con count < k — preserva privacy de quasi-identifier', () => {
    const buckets = [
      { tipo: 'carga_seca', viajes: 6, co2e_kg: 600 },
      { tipo: 'refrigerada', viajes: 3, co2e_kg: 150 }, // < k, debe DROP
      { tipo: 'gnv', viajes: 1, co2e_kg: 30 }, // < k, debe DROP
    ];
    const r = aplicarKAnonymityQuasiId(buckets);
    expect(r).toEqual([{ tipo: 'carga_seca', viajes: 6, co2e_kg: 600 }]);
  });

  it('todos buckets >= k → no filtra', () => {
    const buckets = [
      { fuel_type: 'diesel', viajes: 10, co2e_kg: 1000 },
      { fuel_type: 'gnv', viajes: 5, co2e_kg: 200 },
    ];
    expect(aplicarKAnonymityQuasiId(buckets)).toEqual(buckets);
  });

  it('all sub-k → array vacío (zona sin tipos con suficientes viajes)', () => {
    const buckets = [
      { tipo: 'a', viajes: 2, co2e_kg: 20 },
      { tipo: 'b', viajes: 3, co2e_kg: 30 },
    ];
    expect(aplicarKAnonymityQuasiId(buckets)).toEqual([]);
  });
});
