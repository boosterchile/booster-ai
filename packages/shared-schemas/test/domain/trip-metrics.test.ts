import { describe, expect, it } from 'vitest';
import {
  type NivelCertificacion,
  type RouteDataSource,
  nivelCertificacionSchema,
  routeDataSourceSchema,
  tripMetricsSchema,
  tripMetricsSourceSchema,
} from '../../src/domain/trip-metrics.js';

/**
 * Tests del modelo dual de fuente de datos (ADR-028). Validan que:
 *   1. Los enums nuevos solo aceptan valores documentados en el ADR.
 *   2. tripMetricsSchema acepta los campos nuevos como nullable.
 *   3. Backwards compatibility: el campo deprecado `source` sigue
 *      aceptando valores legacy sin romper validation.
 *   4. Combinaciones de cobertura inválidas son rechazadas.
 */

describe('routeDataSourceSchema (ADR-028)', () => {
  it('acepta los tres valores documentados en ADR-028 §1', () => {
    const valores: RouteDataSource[] = ['teltonika_gps', 'maps_directions', 'manual_declared'];
    for (const v of valores) {
      expect(routeDataSourceSchema.parse(v)).toBe(v);
    }
  });

  it('rechaza valores fuera del enum (no permitir self-declared sources)', () => {
    expect(() => routeDataSourceSchema.parse('teltonika')).toThrow();
    expect(() => routeDataSourceSchema.parse('phone_gps')).toThrow();
    expect(() => routeDataSourceSchema.parse('')).toThrow();
  });
});

describe('nivelCertificacionSchema (ADR-028)', () => {
  it('acepta los tres niveles definidos por la matriz de derivación', () => {
    const niveles: NivelCertificacion[] = [
      'primario_verificable',
      'secundario_modeled',
      'secundario_default',
    ];
    for (const n of niveles) {
      expect(nivelCertificacionSchema.parse(n)).toBe(n);
    }
  });

  it('rechaza valores que aparenten ser niveles válidos pero no lo son', () => {
    expect(() => nivelCertificacionSchema.parse('primario')).toThrow();
    expect(() => nivelCertificacionSchema.parse('verificable')).toThrow();
    expect(() => nivelCertificacionSchema.parse('SECUNDARIO_MODELED')).toThrow();
  });
});

describe('tripMetricsSourceSchema (deprecated, kept for backwards compat)', () => {
  it('sigue aceptando los valores legacy hasta el backfill', () => {
    expect(tripMetricsSourceSchema.parse('modeled')).toBe('modeled');
    expect(tripMetricsSourceSchema.parse('canbus')).toBe('canbus');
    expect(tripMetricsSourceSchema.parse('driver_app')).toBe('driver_app');
  });
});

describe('tripMetricsSchema con campos ADR-028', () => {
  const baseValid = {
    trip_id: '123e4567-e89b-12d3-a456-426614174000',
    distance_km_estimated: null,
    distance_km_actual: null,
    carbon_emissions_kgco2e_estimated: null,
    carbon_emissions_kgco2e_actual: null,
    fuel_consumed_l_estimated: null,
    fuel_consumed_l_actual: null,
    precision_method: null,
    glec_version: null,
    emission_factor_used: null,
    source: null,
    calculated_at: null,
    certificate_pdf_url: null,
    certificate_sha256: null,
    certificate_kms_key_version: null,
    certificate_issued_at: null,
    created_at: '2026-05-10T00:00:00Z',
    updated_at: '2026-05-10T00:00:00Z',
  };

  it('acepta los nuevos campos como nullable (estado pre-cierre del trip)', () => {
    const parsed = tripMetricsSchema.parse({
      ...baseValid,
      route_data_source: null,
      coverage_pct: null,
      certification_level: null,
      uncertainty_factor: null,
    });
    expect(parsed.route_data_source).toBeNull();
    expect(parsed.coverage_pct).toBeNull();
    expect(parsed.certification_level).toBeNull();
    expect(parsed.uncertainty_factor).toBeNull();
  });

  it('acepta un trip cerrado con cert primario verificable (cobertura completa)', () => {
    const parsed = tripMetricsSchema.parse({
      ...baseValid,
      precision_method: 'exacto_canbus',
      route_data_source: 'teltonika_gps',
      coverage_pct: 98.7,
      certification_level: 'primario_verificable',
      uncertainty_factor: 0.05,
      distance_km_actual: 142.3,
      carbon_emissions_kgco2e_actual: 38.4,
    });
    expect(parsed.certification_level).toBe('primario_verificable');
    expect(parsed.coverage_pct).toBe(98.7);
  });

  it('acepta un trip cerrado con cert secundario modeled (downgrade por cobertura insuficiente)', () => {
    const parsed = tripMetricsSchema.parse({
      ...baseValid,
      precision_method: 'modelado',
      route_data_source: 'teltonika_gps',
      coverage_pct: 72.5,
      certification_level: 'secundario_modeled',
      uncertainty_factor: 0.19,
    });
    expect(parsed.certification_level).toBe('secundario_modeled');
  });

  it('acepta un trip cerrado solo con Maps (sin Teltonika, secundario modeled)', () => {
    const parsed = tripMetricsSchema.parse({
      ...baseValid,
      precision_method: 'por_defecto',
      route_data_source: 'maps_directions',
      coverage_pct: 0,
      certification_level: 'secundario_modeled',
      uncertainty_factor: 0.18,
    });
    expect(parsed.route_data_source).toBe('maps_directions');
    expect(parsed.coverage_pct).toBe(0);
  });

  it('rechaza coverage_pct fuera de [0,100]', () => {
    expect(() =>
      tripMetricsSchema.parse({
        ...baseValid,
        route_data_source: 'teltonika_gps',
        coverage_pct: 105,
        certification_level: null,
        uncertainty_factor: null,
      }),
    ).toThrow();

    expect(() =>
      tripMetricsSchema.parse({
        ...baseValid,
        route_data_source: 'teltonika_gps',
        coverage_pct: -1,
        certification_level: null,
        uncertainty_factor: null,
      }),
    ).toThrow();
  });

  it('rechaza uncertainty_factor fuera de [0,1]', () => {
    expect(() =>
      tripMetricsSchema.parse({
        ...baseValid,
        route_data_source: null,
        coverage_pct: null,
        certification_level: null,
        uncertainty_factor: 1.5,
      }),
    ).toThrow();
  });
});
