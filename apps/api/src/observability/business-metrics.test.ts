import { describe, expect, it } from 'vitest';
import { getBusinessCounter, getBusinessHistogram } from './business-metrics.js';

describe('instrumentos de negocio', () => {
  it('reutiliza el counter y el histogram por nombre', () => {
    expect(getBusinessCounter('gps_scorecard_test_counter')).toBe(
      getBusinessCounter('gps_scorecard_test_counter'),
    );
    const histograma = getBusinessHistogram('gps_scorecard_test_hist', {
      description: 'prueba',
      unit: '%',
    });
    expect(getBusinessHistogram('gps_scorecard_test_hist')).toBe(histograma);
    expect(getBusinessHistogram('gps_scorecard_test_hist_bare')).toBe(
      getBusinessHistogram('gps_scorecard_test_hist_bare'),
    );
    expect(() =>
      getBusinessHistogram('gps_scorecard_test_hist_unit', { unit: '%' }).record(1),
    ).not.toThrow();
    expect(() => histograma.record(12)).not.toThrow();
  });
});
