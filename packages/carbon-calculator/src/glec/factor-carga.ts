import type { ConfiguracionViaje, ParametrosPorDefecto } from '../tipos.js';

/**
 * Corrección del consumo según factor de carga.
 *
 * **GLEC Framework v3.0 §6.3**: el consumo de combustible escala
 * APROXIMADAMENTE lineal con la masa total del vehículo (curb weight +
 * carga). Modelos más sofisticados (ACEA, COPERT) usan curvas según tipo
 * de vehículo y velocidad, pero para este piloto la aproximación lineal
 * con coeficiente α calibrado por categoría es suficientemente precisa
 * (±5-10% vs realidad).
 *
 * Fórmula:
 *
 *     consumoReal = consumoBase × (1 + α × (cargaKg / capacidadKg − 0.5))
 *
 * Anclada a "carga normal = 50% de capacidad":
 *   - ratio 0.5 (50% load) → factor 1.00 (consumo igual al base) ✓
 *   - ratio 1.0 (full)     → factor (1 + α/2)  (más consumo)
 *   - ratio 0   (vacío)    → factor (1 − α/2)  (menos consumo)
 *
 * Coeficiente α por categoría (GLEC §6.3, Tabla 6-3):
 *   - **LDV** (Light Duty Vehicle, ≤ 3.5 t GVW): α = 0.05
 *   - **MDV** (Medium Duty Vehicle, 3.5-12 t GVW): α = 0.10
 *   - **HDV** (Heavy Duty Vehicle, > 12 t GVW): α = 0.15
 *
 * Antes (v1, descontinuado): α = 0.10 universal. Causaba sobre-estimar
 * el efecto carga en LDVs y subestimar en HDVs por ~5%.
 */

export type CategoriaVehiculo = 'LDV' | 'MDV' | 'HDV';

const ALFA_POR_CATEGORIA: Readonly<Record<CategoriaVehiculo, number>> = {
  LDV: 0.05,
  MDV: 0.1,
  HDV: 0.15,
};

/**
 * Mapea `tipoVehiculo` (enum del schema) a categoría GLEC.
 *
 * Criterio: Gross Vehicle Weight (GVW) que es ≈ pesoVacio + capacidadKg.
 * Para los tipos definidos en el sistema:
 *   - camioneta, furgon_pequeno: GVW < 3.5 t → LDV
 *   - furgon_mediano, camion_pequeno: 3.5-12 t → MDV
 *   - camion_mediano, refrigerado: 12-26 t → HDV (rígido medio)
 *   - camion_pesado, semi_remolque, tanque: > 26 t → HDV (pesado)
 */
export function categoriaVehiculo(
  tipoVehiculo: ParametrosPorDefecto['tipoVehiculo'],
): CategoriaVehiculo {
  switch (tipoVehiculo) {
    case 'camioneta':
    case 'furgon_pequeno':
      return 'LDV';
    case 'furgon_mediano':
    case 'camion_pequeno':
      return 'MDV';
    case 'camion_mediano':
    case 'camion_pesado':
    case 'semi_remolque':
    case 'refrigerado':
    case 'tanque':
      return 'HDV';
    // W4a (ADR-073) — tipos nuevos de `tipo_unidad` (migración 0048).
    // `tracto_camion` (chasís solo, sin carga propia) y los dos arrastres
    // (`semirremolque`/`remolque`) clasifican HDV por clase de peso, igual
    // que sus equivalentes legacy más cercanos arriba. Los 9 valores legacy
    // de arriba NO cambian de comportamiento (compat legacy).
    case 'tracto_camion':
    case 'semirremolque':
    case 'remolque':
      return 'HDV';
  }
}

/**
 * D4 (decisiones.md) — clase GLEC derivada de la CONFIGURACIÓN de viaje
 * (motriz + 0..1 arrastre), no del vehículo suelto como `categoriaVehiculo()`
 * arriba. Reglas aprobadas por el PO:
 *
 *   - Con arrastre enganchado → configuración articulada → siempre 'HDV',
 *     independiente del peso agregado (un tracto+semi liviano sigue siendo
 *     un articulado a efectos de manejo/consumo/GLEC).
 *   - Motriz sola → por GVW agregado (`curbWeightKg + capacityKg`):
 *     < 3.5 t → LDV, 3.5–16 t → MDV, > 16 t → HDV.
 *
 * Fuentes / verificación (ver docs/adr/073 §Fuentes normativas para el
 * detalle): la segmentación LDV/MDV/HDV por GVW está alineada con el
 * espíritu de GLEC Framework v3.0 §6.3 (la misma fuente de
 * `categoriaVehiculo()`/`ALFA_POR_CATEGORIA` arriba), pero el corte
 * numérico exacto de 16 t para el techo de MDV **no está tomado
 * literalmente de una tabla publicada** — es una convención de ingeniería
 * del proyecto (razonable pero **referencial**, no una cita verificada).
 * D.S. N°158/1980 (MOP, no MTT — ver corrección de atribución en el ADR)
 * fija pesos máximos de circulación en Chile pero no define por sí mismo
 * una segmentación LDV/MDV/HDV.
 */
export function categoriaPorConfiguracion(configuracion: ConfiguracionViaje): CategoriaVehiculo {
  if (configuracion.arrastre) {
    return 'HDV';
  }

  const gvwTon = (configuracion.motriz.curbWeightKg + configuracion.motriz.capacityKg) / 1000;
  if (gvwTon < 3.5) {
    return 'LDV';
  }
  if (gvwTon <= 16) {
    return 'MDV';
  }
  return 'HDV';
}

/**
 * Devuelve el factor multiplicador a aplicar al consumo base según
 * la carga real vs capacidad nominal.
 *
 * - `categoria` (opcional) calibra α según GLEC §6.3. Si no se pasa,
 *   default a 'MDV' (α = 0.10) — comportamiento legacy compatible.
 * - Si capacidad ≤ 0 → retorna 1 (sin corrección).
 * - Si la carga supera la capacidad → cap a 1.5× para evitar valores
 *   absurdos (puede pasar por errores de declaración).
 *
 * @example
 *   // Camión pesado al 80% de capacidad:
 *   calcularFactorCorreccionPorCarga({ cargaKg: 22400, capacidadKg: 28000, categoria: 'HDV' })
 *   // → 1 + 0.15 × (0.8 − 0.5) = 1.045
 */
export function calcularFactorCorreccionPorCarga(opts: {
  cargaKg: number;
  capacidadKg: number;
  categoria?: CategoriaVehiculo | undefined;
  /**
   * Override directo del α. Útil para tests o calibración por modelo
   * específico. Si se pasa, ignora `categoria`.
   */
  alfa?: number | undefined;
}): number {
  const { cargaKg, capacidadKg, categoria, alfa: alfaOverride } = opts;
  if (capacidadKg <= 0) {
    return 1;
  }
  const alfa = alfaOverride ?? ALFA_POR_CATEGORIA[categoria ?? 'MDV'];
  const ratio = Math.min(cargaKg / capacidadKg, 1.5);
  return 1 + alfa * (ratio - 0.5);
}
