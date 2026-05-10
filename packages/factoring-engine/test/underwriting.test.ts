import { describe, expect, it } from 'vitest';
import { evaluarShipper } from '../src/index.js';

const HOY_MS = Date.UTC(2026, 5, 15, 12, 0, 0);

function base(over: Partial<Parameters<typeof evaluarShipper>[0]['input']> = {}) {
  return {
    input: {
      equifaxScore: 750,
      rutActivo: true,
      antiguedadMeses: 36,
      morosidadUltimo12m: false,
      exposicionActualClp: 0,
      ...over,
    },
    hoyMs: HOY_MS,
  };
}

describe('evaluarShipper — hard rules', () => {
  it('rutActivo=false → rechazado automático', () => {
    const r = evaluarShipper(base({ rutActivo: false }));
    expect(r.approved).toBe(false);
    expect(r.motivo).toContain('RUT no activo');
    expect(r.decidedBy).toBe('automatico');
    expect(r.limitExposureClp).toBe(0);
  });

  it('antigüedad < 24 meses → rechazado', () => {
    const r = evaluarShipper(base({ antiguedadMeses: 12 }));
    expect(r.approved).toBe(false);
    expect(r.motivo).toContain('Antigüedad');
  });

  it('morosidad reportada → rechazado', () => {
    const r = evaluarShipper(base({ morosidadUltimo12m: true }));
    expect(r.approved).toBe(false);
    expect(r.motivo).toContain('Morosidad');
  });
});

describe('evaluarShipper — score Equifax', () => {
  it('score ≥700 → aprobado con límite estándar $50M', () => {
    const r = evaluarShipper(base({ equifaxScore: 750 }));
    expect(r.approved).toBe(true);
    expect(r.limitExposureClp).toBe(50_000_000);
    expect(r.decidedBy).toBe('automatico');
  });

  it('score exacto 700 → aprobado límite estándar', () => {
    const r = evaluarShipper(base({ equifaxScore: 700 }));
    expect(r.approved).toBe(true);
    expect(r.limitExposureClp).toBe(50_000_000);
  });

  it('score 550-699 → aprobado con límite reducido $10M', () => {
    const r = evaluarShipper(base({ equifaxScore: 600 }));
    expect(r.approved).toBe(true);
    expect(r.limitExposureClp).toBe(10_000_000);
  });

  it('score exacto 550 → aprobado reducido', () => {
    const r = evaluarShipper(base({ equifaxScore: 550 }));
    expect(r.approved).toBe(true);
    expect(r.limitExposureClp).toBe(10_000_000);
  });

  it('score 549 → rechazado', () => {
    const r = evaluarShipper(base({ equifaxScore: 549 }));
    expect(r.approved).toBe(false);
    expect(r.motivo).toContain('Score');
  });

  it('score null → manual_requerido (no aprobado automático)', () => {
    const r = evaluarShipper(base({ equifaxScore: null }));
    expect(r.approved).toBe(false);
    expect(r.decidedBy).toBe('manual_requerido');
    expect(r.motivo).toContain('manual');
  });
});

describe('evaluarShipper — concentración de exposición', () => {
  it('exposición = límite → rechazado por concentración', () => {
    const r = evaluarShipper(base({ equifaxScore: 750, exposicionActualClp: 50_000_000 }));
    expect(r.approved).toBe(false);
    expect(r.motivo).toContain('Exposición');
  });

  it('exposición > límite → rechazado', () => {
    const r = evaluarShipper(base({ equifaxScore: 750, exposicionActualClp: 60_000_000 }));
    expect(r.approved).toBe(false);
  });

  it('score 600 + exposición 9M < límite 10M → aprobado', () => {
    const r = evaluarShipper(base({ equifaxScore: 600, exposicionActualClp: 9_000_000 }));
    expect(r.approved).toBe(true);
    expect(r.limitExposureClp).toBe(10_000_000);
  });

  it('score 600 + exposición 10M = límite reducido → rechazado', () => {
    const r = evaluarShipper(base({ equifaxScore: 600, exposicionActualClp: 10_000_000 }));
    expect(r.approved).toBe(false);
  });
});

describe('evaluarShipper — expiración', () => {
  it('default 30 días', () => {
    const r = evaluarShipper(base({}));
    const esperado = new Date(HOY_MS + 30 * 24 * 60 * 60 * 1000);
    expect(r.expiresAt.toISOString()).toBe(esperado.toISOString());
  });

  it('validezDias custom (7) → expiresAt = hoy + 7d', () => {
    const r = evaluarShipper({ ...base({}), validezDias: 7 });
    const esperado = new Date(HOY_MS + 7 * 24 * 60 * 60 * 1000);
    expect(r.expiresAt.toISOString()).toBe(esperado.toISOString());
  });

  it('rechazo también incluye expiresAt', () => {
    const r = evaluarShipper(base({ rutActivo: false }));
    expect(r.expiresAt).toBeInstanceOf(Date);
  });
});

describe('evaluarShipper — validación inputs', () => {
  it('hoyMs NaN → throw', () => {
    expect(() => evaluarShipper({ ...base({}), hoyMs: Number.NaN })).toThrow(/hoyMs/);
  });

  it('hoyMs negativo → throw', () => {
    expect(() => evaluarShipper({ ...base({}), hoyMs: -1 })).toThrow(/hoyMs/);
  });

  it('validezDias 0 → throw', () => {
    expect(() => evaluarShipper({ ...base({}), validezDias: 0 })).toThrow(/validezDias/);
  });

  it('equifaxScore negativo → throw', () => {
    expect(() => evaluarShipper(base({ equifaxScore: -100 }))).toThrow(/equifaxScore/);
  });

  it('equifaxScore NaN → throw', () => {
    expect(() => evaluarShipper(base({ equifaxScore: Number.NaN }))).toThrow(/equifaxScore/);
  });
});
