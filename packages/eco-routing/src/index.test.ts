import { describe, expect, it } from 'vitest';
import * as eco from './index.js';

describe('@booster-ai/eco-routing entrypoint', () => {
  it('exporta detector, evaluador y defaults', () => {
    expect(typeof eco.detectarCongestion).toBe('function');
    expect(typeof eco.evaluarAlternativas).toBe('function');
    expect(eco.DEFAULTS_DETECTOR.umbralKmh).toBe(10);
    expect(eco.DEFAULTS_EVALUADOR.mejoraMinimaPct).toBe(0.1);
  });
});
