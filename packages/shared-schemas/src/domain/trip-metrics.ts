import { z } from 'zod';
import { tripRequestIdSchema } from '../primitives/ids.js';

/**
 * Método de precisión del cálculo GLEC v3.0:
 *   - exacto_canbus: telemetría real desde el bus del vehículo
 *   - modelado: estimación basada en distancia + factor por tipo
 *   - por_defecto: factor genérico cuando no hay vehículo declarado
 *
 * Captura la **calidad de la medición de combustible/distancia**. Es la
 * primera de las tres dimensiones ortogonales definidas en ADR-028.
 */
export const precisionMethodSchema = z.enum(['exacto_canbus', 'modelado', 'por_defecto']);
export type PrecisionMethod = z.infer<typeof precisionMethodSchema>;

/**
 * Origen del polyline real recorrido por el vehículo. Segunda dimensión
 * ortogonal al `precision_method` (ADR-028 §1):
 *
 *   - teltonika_gps: pings GPS del dispositivo Teltonika a lo largo del trip.
 *     Es la única fuente que califica para certificado primario verificable.
 *   - maps_directions: ruta sintetizada por Google Routes API
 *     (`computeRoutes` con `vehicleInfo` + `extraComputations`). Es secundaria
 *     modeled — el polyline NO está confirmado, se asume.
 *   - manual_declared: cliente declaró origen→destino sin telemetría ni
 *     simulación. Worst case, secundario default.
 */
export const routeDataSourceSchema = z.enum([
  'teltonika_gps',
  'maps_directions',
  'manual_declared',
]);
export type RouteDataSource = z.infer<typeof routeDataSourceSchema>;

/**
 * Nivel de certificación derivado (ADR-028 §2). NO es self-declared: lo
 * computa `derivarNivelCertificacion()` en `packages/carbon-calculator` a
 * partir de las tres dimensiones (`precision_method`, `route_data_source`,
 * `coverage_pct`). El cliente NO puede setearlo manualmente.
 *
 *   - primario_verificable: GLEC §4.4 nivel 1 — auditable bajo SBTi/CDP.
 *   - secundario_modeled: GLEC §4.4 nivel 2 con factores calibrados.
 *   - secundario_default: GLEC §4.4 nivel 2 con factores genéricos (último
 *     fallback, cuando no hay calibración local disponible).
 */
export const nivelCertificacionSchema = z.enum([
  'primario_verificable',
  'secundario_modeled',
  'secundario_default',
]);
export type NivelCertificacion = z.infer<typeof nivelCertificacionSchema>;

/**
 * @deprecated Reemplazado por `route_data_source` (ADR-028). El campo
 * sigue en BD y schema por backwards-compatibility con trips históricos
 * hasta que el backfill complete; eliminar en ADR posterior una vez
 * migrados todos los registros.
 *
 *   - modeled → equivale a `route_data_source = 'maps_directions'`
 *   - canbus → equivale a `route_data_source = 'teltonika_gps'`
 *   - driver_app → equivale a `route_data_source = 'manual_declared'`
 */
export const tripMetricsSourceSchema = z.enum(['modeled', 'canbus', 'driver_app']);
export type TripMetricsSource = z.infer<typeof tripMetricsSourceSchema>;

/**
 * Métricas ESG por viaje (1:1 con `viajes`). Separar de `trip_requests`
 * mantiene la tabla operacional limpia y permite que el carbon-calculator
 * actualice estimaciones sin tocar el lifecycle del viaje.
 *
 * Estimadas: calculadas al confirmar pickup, basadas en perfil del
 * vehículo + distancia planificada.
 *
 * Reales: actualizadas al confirmar entrega con telemetría/datos reales.
 *
 * ADR-028 introduce los campos de fuente dual:
 *   - route_data_source, coverage_pct: capturan qué % del viaje está
 *     cubierto por telemetría real vs modelado.
 *   - certification_level: derivado al cierre del trip; alimenta el
 *     selector de template del certificate-generator.
 *   - uncertainty_factor: ± publicado en el cert ("12.4 ± 0.6 kg CO₂e").
 */
export const tripMetricsSchema = z.object({
  trip_id: tripRequestIdSchema,
  distance_km_estimated: z.number().nonnegative().nullable(),
  distance_km_actual: z.number().nonnegative().nullable(),
  carbon_emissions_kgco2e_estimated: z.number().nonnegative().nullable(),
  carbon_emissions_kgco2e_actual: z.number().nonnegative().nullable(),
  fuel_consumed_l_estimated: z.number().nonnegative().nullable(),
  fuel_consumed_l_actual: z.number().nonnegative().nullable(),
  precision_method: precisionMethodSchema.nullable(),
  glec_version: z.string().nullable(),
  emission_factor_used: z.number().nonnegative().nullable(),
  /** @deprecated Ver `route_data_source` (ADR-028). Mantener nullable hasta backfill. */
  source: tripMetricsSourceSchema.nullable(),
  /**
   * Origen del polyline real recorrido (ADR-028). Independiente de la
   * calidad de medición de combustible/distancia (`precision_method`).
   * Nullable hasta el backfill de trips históricos.
   */
  route_data_source: routeDataSourceSchema.nullable(),
  /**
   * Fracción del viaje cubierta por la fuente principal, en porcentaje
   * [0..100]. Se usa para downgrade automático del nivel de certificación
   * cuando la cobertura cae por debajo del threshold (95% para primario,
   * 80% para secundario modeled). Para trips sin telemetría se setea a 0.
   * Nullable hasta el backfill.
   */
  coverage_pct: z.number().min(0).max(100).nullable(),
  /**
   * Nivel de certificación derivado al cierre del trip (ADR-028 §2).
   * Computed, no auto-declared. Selecciona el template del cert-generator.
   * Nullable hasta que el trip cierre y se ejecute el cálculo.
   */
  certification_level: nivelCertificacionSchema.nullable(),
  /**
   * Factor de incertidumbre publicado en el certificado (ADR-028 §3).
   * Decimal en [0, 1]. Ej: 0.05 = ±5%. Nullable hasta cierre del trip.
   */
  uncertainty_factor: z.number().min(0).max(1).nullable(),
  calculated_at: z.string().datetime().nullable(),
  certificate_pdf_url: z.string().url().nullable(),
  certificate_sha256: z.string().length(64).nullable(),
  certificate_kms_key_version: z.string().nullable(),
  certificate_issued_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type TripMetrics = z.infer<typeof tripMetricsSchema>;
