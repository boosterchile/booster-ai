import { describe, expect, it } from 'vitest';
import { serializeTripMetrics } from '../../src/routes/trip-requests-v2.js';

/**
 * ADR-077 §4 — el detalle del viaje expone la línea de método derivada (misma
 * función que el PDF) más las tres dimensiones crudas, para que la app
 * muestre el chip sin reconstruir vocabulario.
 */
const base = {
  distanceKmEstimated: '120.00',
  distanceKmActual: '118.30',
  carbonEmissionsKgco2eEstimated: '40.000',
  carbonEmissionsKgco2eActual: '39.120',
  precisionMethod: 'modelado' as const,
  glecVersion: 'v3.0',
  routeDataSource: 'movil_gps' as const,
  coveragePct: '96.40',
  certificationLevel: 'secundario_modeled' as const,
  certificatePdfUrl: null,
  certificateSha256: null,
  certificateKmsKeyVersion: null,
  certificateIssuedAt: null,
};

describe('serializeTripMetrics — línea de método en el detalle del viaje', () => {
  it('deriva linea_metodo desde método × fuente × cobertura y expone las dimensiones crudas', () => {
    const m = serializeTripMetrics(base);
    expect(m.route_data_source).toBe('movil_gps');
    expect(m.coverage_pct).toBe('96.40');
    expect(m.certification_level).toBe('secundario_modeled');
    expect(m.linea_metodo).toBe(
      'Distancia medida por GPS del móvil del conductor (cobertura 96 %) · Consumo modelado según GLEC v3.0',
    );
    expect(m.carbon_emissions_kgco2e_actual).toBe('39.120');
  });

  it('sin fuente de ruta o sin cobertura (métricas legacy) → linea_metodo null', () => {
    expect(serializeTripMetrics({ ...base, routeDataSource: null }).linea_metodo).toBeNull();
    expect(serializeTripMetrics({ ...base, coveragePct: null }).linea_metodo).toBeNull();
  });

  it('sin metodo_precision → linea_metodo null (no se asume)', () => {
    expect(serializeTripMetrics({ ...base, precisionMethod: null }).linea_metodo).toBeNull();
  });
});
