import { describe, expect, it } from 'vitest';
// RED: `declaracionDistancia` aún no existe. Es el invariante de honestidad del
// paso 1 (F0-0 §7 / spec `distancia-real-hibrida`): con cobertura < 100% el cert
// NO puede declarar "distancia medida" a secas — debe declarar la mezcla
// "medido X%, estimado (100−X)%", con X = coverage_pct. Sin esto se reintroduce
// el sesgo direccional a la baja que motivó todo el fix.
import { declaracionDistancia } from './render-helpers.js';

describe('declaracionDistancia — invariante de honestidad de la distancia', () => {
  it('cobertura 100% → declara medida; NO menciona estimado', () => {
    const d = declaracionDistancia(100);
    expect(d).toMatch(/medid/i);
    expect(d).not.toMatch(/estimad/i);
  });

  it('cobertura 60% → declara la mezcla "medido 60%, estimado 40%"', () => {
    const d = declaracionDistancia(60);
    expect(d).toContain('60%');
    expect(d).toContain('40%');
    expect(d).toMatch(/medid/i);
    expect(d).toMatch(/estimad/i);
  });

  it('INVARIANTE: con cobertura < 100% NUNCA declara "medida" a secas — siempre incluye el estimado', () => {
    for (const cov of [1, 30, 60, 80, 99]) {
      const d = declaracionDistancia(cov);
      // debe declarar la porción estimada (100 − X) explícitamente
      expect(d, `cobertura ${cov}%`).toMatch(/estimad/i);
      expect(d, `cobertura ${cov}%`).toContain(`${100 - cov}%`);
      // y no puede ser una declaración de "medida" sin cualificar
      expect(d.toLowerCase(), `cobertura ${cov}%`).not.toBe('medida');
    }
  });

  it('X = coverage_pct: la fracción medida declarada es exactamente la cobertura', () => {
    expect(declaracionDistancia(72)).toContain('72%');
    expect(declaracionDistancia(72)).toContain('28%');
  });

  it('cobertura 0% o sin telemetría → declara estimada (no medida)', () => {
    for (const cov of [0, undefined]) {
      const d = declaracionDistancia(cov);
      expect(d, `cobertura ${cov}`).toMatch(/estimad/i);
      expect(d.toLowerCase(), `cobertura ${cov}`).not.toMatch(/medid/i);
    }
  });
});
