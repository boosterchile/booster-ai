import { describe, expect, it } from 'vitest';
import { calcularScoreConduccion } from '../src/calcular-score.js';
import type { EventoConduccion, TipoEvento } from '../src/tipos.js';

/**
 * Tests del scoring v1 (Phase 2 PR-I3).
 *
 * El score afecta directamente la UX del transportista (dashboard) y
 * potencialmente decisiones del shipper (preferir carriers con score
 * alto). Tests exhaustivos por construcción.
 */

function makeEvent(type: TipoEvento, overrides: Partial<EventoConduccion> = {}): EventoConduccion {
  return {
    type,
    severity: type === 'exceso_velocidad' ? 110 : 1850,
    timestampMs: 1_777_000_000_000,
    ...overrides,
  };
}

describe('calcularScoreConduccion — score baseline', () => {
  it('sin eventos → 100 (excelente)', () => {
    const r = calcularScoreConduccion({ events: [], tripDurationMinutes: 60 });
    expect(r.score).toBe(100);
    expect(r.nivel).toBe('excelente');
    expect(r.desglose.penalizacionTotal).toBe(0);
    expect(r.desglose.eventosPorHora).toBe(0);
  });

  it('1 frenado → 95 (excelente)', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('frenado_brusco')],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(95);
    expect(r.nivel).toBe('excelente');
    expect(r.desglose.penalizacionTotal).toBe(5);
  });

  it('1 exceso velocidad → 98 (excelente)', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('exceso_velocidad')],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(98);
    expect(r.nivel).toBe('excelente');
    expect(r.desglose.penalizacionTotal).toBe(2);
  });
});

describe('calcularScoreConduccion — pesos por tipo', () => {
  it('aceleración brusca pesa 5', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('aceleracion_brusca')],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(95);
  });

  it('frenado brusco pesa 5', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('frenado_brusco')],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(95);
  });

  it('curva brusca pesa 5', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('curva_brusca')],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(95);
  });

  it('exceso velocidad pesa 2 (peso menor: seguridad, no eficiencia)', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('exceso_velocidad')],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(98);
  });
});

describe('calcularScoreConduccion — bucketización (niveles)', () => {
  // Helper: crea N eventos de exceso_velocidad para alcanzar exactamente
  // el penalty target (cada uno suma 2).
  const eventosParaPenalty = (target: number): EventoConduccion[] =>
    Array.from({ length: target / 2 }, () => makeEvent('exceso_velocidad'));

  it('score 100 → excelente', () => {
    expect(calcularScoreConduccion({ events: [], tripDurationMinutes: 60 }).nivel).toBe(
      'excelente',
    );
  });

  it('score 90 → excelente (boundary)', () => {
    const r = calcularScoreConduccion({
      events: eventosParaPenalty(10),
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(90);
    expect(r.nivel).toBe('excelente');
  });

  it('score 89 → bueno (cae bajo threshold de excelente)', () => {
    // 11 puntos de penalty: 1 harsh (5) + 3 exceso (6) = 11
    const r = calcularScoreConduccion({
      events: [makeEvent('frenado_brusco'), ...eventosParaPenalty(6)],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(89);
    expect(r.nivel).toBe('bueno');
  });

  it('score 70 → bueno (boundary)', () => {
    const r = calcularScoreConduccion({
      events: eventosParaPenalty(30),
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(70);
    expect(r.nivel).toBe('bueno');
  });

  it('score 69 → regular', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('frenado_brusco'), ...eventosParaPenalty(26)],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(69);
    expect(r.nivel).toBe('regular');
  });

  it('score 50 → regular (boundary)', () => {
    const r = calcularScoreConduccion({
      events: eventosParaPenalty(50),
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(50);
    expect(r.nivel).toBe('regular');
  });

  it('score 49 → malo', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('frenado_brusco'), ...eventosParaPenalty(46)],
      tripDurationMinutes: 60,
    });
    expect(r.score).toBe(49);
    expect(r.nivel).toBe('malo');
  });
});

describe('calcularScoreConduccion — cap inferior', () => {
  it('penalty > 100 → score = 0 (no negativo)', () => {
    // 25 frenados × 5 = 125 puntos de penalty.
    const events = Array.from({ length: 25 }, () => makeEvent('frenado_brusco'));
    const r = calcularScoreConduccion({ events, tripDurationMinutes: 60 });
    expect(r.score).toBe(0);
    expect(r.nivel).toBe('malo');
    expect(r.desglose.penalizacionTotal).toBe(125); // valor real (sin cap), para auditoría
  });

  it('penalty exactamente 100 → score = 0', () => {
    const events = Array.from({ length: 20 }, () => makeEvent('frenado_brusco'));
    const r = calcularScoreConduccion({ events, tripDurationMinutes: 60 });
    expect(r.score).toBe(0);
    expect(r.desglose.penalizacionTotal).toBe(100);
  });
});

describe('calcularScoreConduccion — desglose contadores', () => {
  it('cuenta cada tipo por separado', () => {
    const events = [
      makeEvent('aceleracion_brusca'),
      makeEvent('aceleracion_brusca'),
      makeEvent('frenado_brusco'),
      makeEvent('curva_brusca'),
      makeEvent('curva_brusca'),
      makeEvent('curva_brusca'),
      makeEvent('exceso_velocidad'),
    ];
    const r = calcularScoreConduccion({ events, tripDurationMinutes: 60 });
    expect(r.desglose.aceleracionesBruscas).toBe(2);
    expect(r.desglose.frenadosBruscos).toBe(1);
    expect(r.desglose.curvasBruscas).toBe(3);
    expect(r.desglose.excesosVelocidad).toBe(1);
    // Penalty: (2+1+3) × 5 + 1 × 2 = 30 + 2 = 32 → score 68
    expect(r.score).toBe(68);
    expect(r.desglose.penalizacionTotal).toBe(32);
  });

  it('shape del desglose es estable aunque algún tipo no aparezca', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('frenado_brusco')],
      tripDurationMinutes: 60,
    });
    // Garantizamos shape para que el front no tenga que checkear undefined.
    expect(r.desglose.aceleracionesBruscas).toBe(0);
    expect(r.desglose.curvasBruscas).toBe(0);
    expect(r.desglose.excesosVelocidad).toBe(0);
    expect(r.desglose.frenadosBruscos).toBe(1);
  });
});

describe('calcularScoreConduccion — eventosPorHora', () => {
  it('60 min con 6 eventos → 6 eventos/hora', () => {
    const events = Array.from({ length: 6 }, () => makeEvent('exceso_velocidad'));
    const r = calcularScoreConduccion({ events, tripDurationMinutes: 60 });
    expect(r.desglose.eventosPorHora).toBe(6);
  });

  it('30 min con 6 eventos → 12 eventos/hora', () => {
    const events = Array.from({ length: 6 }, () => makeEvent('exceso_velocidad'));
    const r = calcularScoreConduccion({ events, tripDurationMinutes: 30 });
    expect(r.desglose.eventosPorHora).toBe(12);
  });

  it('tripDurationMinutes = 0 → eventosPorHora = NaN (no aplica)', () => {
    const r = calcularScoreConduccion({
      events: [makeEvent('frenado_brusco')],
      tripDurationMinutes: 0,
    });
    expect(Number.isNaN(r.desglose.eventosPorHora)).toBe(true);
  });

  it('tripDurationMinutes negativo → NaN', () => {
    const r = calcularScoreConduccion({ events: [], tripDurationMinutes: -5 });
    expect(Number.isNaN(r.desglose.eventosPorHora)).toBe(true);
  });
});

describe('calcularScoreConduccion — determinismo', () => {
  it('mismo input → mismo output (función pura)', () => {
    const events = [
      makeEvent('frenado_brusco', { timestampMs: 100, severity: 2400 }),
      makeEvent('exceso_velocidad', { timestampMs: 200, severity: 115 }),
      makeEvent('aceleracion_brusca', { timestampMs: 300, severity: 1900 }),
    ];
    const r1 = calcularScoreConduccion({ events, tripDurationMinutes: 90 });
    const r2 = calcularScoreConduccion({ events, tripDurationMinutes: 90 });
    expect(r1).toEqual(r2);
  });

  it('orden de eventos NO afecta el resultado', () => {
    const events = [
      makeEvent('frenado_brusco'),
      makeEvent('aceleracion_brusca'),
      makeEvent('exceso_velocidad'),
    ];
    const reversed = [...events].reverse();
    const r1 = calcularScoreConduccion({ events, tripDurationMinutes: 60 });
    const r2 = calcularScoreConduccion({ events: reversed, tripDurationMinutes: 60 });
    expect(r1.score).toBe(r2.score);
    expect(r1.desglose).toEqual(r2.desglose);
  });
});
