/**
 * Tipos compartidos del carbon-calculator.
 *
 * Diseño:
 *   - Todo el cálculo es PURO (input → output, sin I/O ni side-effects).
 *   - Las funciones aceptan numbers + enums; no leen de DB ni hacen fetch.
 *   - Quien orquesta la persistencia (servicio en apps/api) es responsable
 *     de mapear desde/hacia trip_metrics.
 *
 * Standard de referencia:
 *   - GLEC Framework v3.0 (Smart Freight Centre, 2023).
 *   - Factores de emisión Chile: SEC + MMA (2024).
 *   - Grid eléctrico: CEN (Coordinador Eléctrico Nacional) factor anual.
 *
 * Importante: los valores TTW (Tank-to-Wheel, combustión real) son
 * estables (química). Los valores WTT (Well-to-Tank, upstream del
 * combustible) varían por país/origen y se actualizan anualmente.
 */

/**
 * Tipos de combustible aceptados. Espejo del enum `tipo_combustible`
 * en apps/api/src/db/schema.ts. Si cambia allá, actualizar acá.
 */
export type TipoCombustible =
  | 'diesel'
  | 'gasolina'
  | 'gas_glp'
  | 'gas_gnc'
  | 'electrico'
  | 'hibrido_diesel'
  | 'hibrido_gasolina'
  | 'hidrogeno';

/**
 * Modo de cálculo según calidad de los datos disponibles. Espejo del
 * enum `metodo_precision` en el schema (apps/api/src/db/schema.ts).
 *
 *   - `exacto_canbus`: telemetría real del vehículo (CAN-BUS via
 *     Teltonika): consumo real, distancia GPS real, RPM/load real.
 *     Mejor precisión, requiere device instalado.
 *   - `modelado`: distancia planificada (Google Maps Routes) +
 *     perfil energético del vehículo declarado en onboarding (consumo
 *     base L/100km × tipo combustible). Precisión media.
 *   - `por_defecto`: vehículo sin perfil energético declarado. Usamos
 *     factor genérico por tipo de vehículo (camion_pesado, etc.).
 *     Precisión baja, sirve solo como floor estimado.
 */
export type MetodoPrecision = 'exacto_canbus' | 'modelado' | 'por_defecto';

/**
 * Factor de emisión completo Well-to-Wheel para un combustible en una
 * jurisdicción específica (Chile). Todos los valores son CO2-equivalente
 * (incluye CH4 + N2O convertidos vía GWP-100 IPCC AR6).
 */
export interface FactorEmisionCombustible {
  /** Código del combustible — match del enum tipo_combustible. */
  combustible: TipoCombustible;
  /**
   * Tank-to-Wheel: emisiones por COMBUSTIÓN del combustible en el motor.
   * Estable; depende de química y blend del combustible.
   *
   * Unidades:
   *   - Diésel/Gasolina/GLP: kgCO2e por LITRO
   *   - GNC: kgCO2e por m³ (a 0 °C, 1 atm — STD volume)
   *   - Eléctrico: kgCO2e por kWh
   *   - Hidrógeno: kgCO2e por kg
   */
  ttwKgco2e: number;
  /**
   * Well-to-Tank: emisiones del UPSTREAM del combustible (extracción,
   * refinería, transporte hasta la estación de servicio). Varía por
   * país de origen del crudo, eficiencia refinería, blend renovable.
   * Mismas unidades que ttwKgco2e.
   */
  wttKgco2e: number;
  /**
   * Densidad energética en MJ por unidad. Para conversiones inter-
   * combustible (intensidad por MJ vs por litro). LHV (lower heating
   * value), GLEC v3.0 default.
   */
  energyMjPerUnit: number;
  /**
   * Unidad física del numerador (L, m3, kWh, kg). Para reporting.
   */
  unidad: 'L' | 'm3' | 'kWh' | 'kg';
  /** Año de los valores. Para auditoría. */
  anioReferencia: number;
  /** Fuente de los valores. Para auditoría. */
  fuente: string;
}

/**
 * Perfil energético del vehículo. Subset de los campos de `vehiculos`
 * que el carbon-calculator necesita.
 */
export interface PerfilVehiculo {
  combustible: TipoCombustible;
  /**
   * Consumo declarado del vehículo a CARGA NORMAL (no vacío, no full).
   * Unidades:
   *   - Diésel/Gasolina/GLP: L/100km
   *   - GNC: m³/100km
   *   - Eléctrico: kWh/100km
   *   - Hidrógeno: kg/100km
   * Null si el carrier no lo declaró → usa default por tipo_vehiculo.
   */
  consumoBasePor100km: number | null;
  /** Peso vacío en kg. Usado para corrección por carga. */
  pesoVacioKg: number | null;
  /** Capacidad útil en kg. Define carga máxima posible. */
  capacidadKg: number;
}

/**
 * Datos del viaje necesarios para el cálculo en modo `modelado`.
 */
export interface ParametrosModelado {
  metodo: 'modelado';
  /** Distancia planificada en km (de Google Maps Routes API). */
  distanciaKm: number;
  /** Carga real en kg que va en el vehículo. */
  cargaKg: number;
  /** Perfil del vehículo. */
  vehiculo: PerfilVehiculo;
}

/**
 * Datos del viaje necesarios para el cálculo en modo `exacto_canbus`.
 * Requiere telemetría real del Teltonika (post-entrega).
 */
export interface ParametrosExactoCanbus {
  metodo: 'exacto_canbus';
  /** Distancia GPS real recorrida en km. */
  distanciaKm: number;
  /** Combustible consumido REAL leído del CAN-BUS. */
  combustibleConsumido: number;
  /** Carga real transportada en kg. */
  cargaKg: number;
  /** Perfil del vehículo. */
  vehiculo: PerfilVehiculo;
}

/**
 * Modo `por_defecto`: vehículo sin perfil energético, usamos factores
 * genéricos del tipo de vehículo. Sirve para viajes sin información
 * técnica suficiente; precisión baja.
 */
export interface ParametrosPorDefecto {
  metodo: 'por_defecto';
  distanciaKm: number;
  cargaKg: number;
  /**
   * Tipo de vehículo según enum `tipo_vehiculo`. Usado para mapear a
   * un consumo y combustible default por categoría.
   */
  tipoVehiculo:
    | 'camioneta'
    | 'furgon_pequeno'
    | 'furgon_mediano'
    | 'camion_pequeno'
    | 'camion_mediano'
    | 'camion_pesado'
    | 'semi_remolque'
    | 'refrigerado'
    | 'tanque';
}

export type ParametrosCalculo = ParametrosModelado | ParametrosExactoCanbus | ParametrosPorDefecto;

/**
 * Resultado del cálculo. Contiene los KPIs principales + desglose
 * para auditoría (factor usado, consumo asumido, etc.). El servicio
 * que persiste en `metricas_viaje` mapea estos campos directo.
 */
export interface ResultadoEmisiones {
  /** Total Well-to-Wheel en kgCO2e. */
  emisionesKgco2eWtw: number;
  /** Desglose: solo combustión (Tank-to-Wheel). */
  emisionesKgco2eTtw: number;
  /** Desglose: solo upstream (Well-to-Tank). */
  emisionesKgco2eWtt: number;
  /** Combustible total consumido en el viaje (en unidad del combustible). */
  combustibleConsumido: number;
  /** Unidad del consumo (L, m3, kWh, kg). */
  unidadCombustible: FactorEmisionCombustible['unidad'];
  /** Distancia considerada en km. */
  distanciaKm: number;
  /**
   * Intensidad de carbono en gCO2e por ton-km transportado. KPI estándar
   * para reporting GLEC. Si carga es 0 (tara), retorna 0.
   */
  intensidadGco2ePorTonKm: number;
  /** Método de precisión usado. */
  metodoPrecision: MetodoPrecision;
  /** Factor de emisión específico aplicado (kgCO2e/unidad). */
  factorEmisionUsado: number;
  /** Versión del framework GLEC. */
  versionGlec: string;
  /** Fuente de los factores (para auditoría). */
  fuenteFactores: string;
}
