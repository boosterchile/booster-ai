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
 * **Fallback por `curbWeightKg` nulo (I2, fix review W4a)**: la columna SQL
 * `vehiculos.peso_vacio_kg` es nullable y la mayoría de las filas del
 * piloto todavía no la declaran. Cuando `configuracion.motriz.curbWeightKg`
 * es `null` (y no hay arrastre — el caso con arrastre ya resuelve a `HDV`
 * sin necesitar el GVW motriz):
 *
 *   1. Si se pasa `tipoVehiculoLegacy`, se usa `categoriaVehiculo(tipoVehiculoLegacy)`
 *      (lookup legacy por tipo, sin peso) como aproximación.
 *   2. Si no hay `tipoVehiculoLegacy`, lanza un `Error` explícito — **nunca**
 *      se asume `curbWeightKg = 0` (inflaría artificialmente el efecto de
 *      la carga y podría, por ejemplo, malclasificar un HDV como LDV/MDV).
 *
 * **Precedencia**: el GVW real (vía 1) es siempre más preciso que el
 * lookup legacy por tipo (vía 2) y gana cuando `curbWeightKg` está
 * presente, incluso si se pasa `tipoVehiculoLegacy` (se ignora en ese
 * caso). El fallback legacy es un peldaño de transición, no un empate.
 *
 * **Nota de transición para W4c (impacto en certificados)**: el lookup
 * legacy por tipo puede diferir del GVW real. Ejemplo: un `camion_mediano`
 * sin `curb_weight_kg` declarado clasifica como `HDV` vía
 * `categoriaVehiculo('camion_mediano')` (ver switch arriba); si ese mismo
 * vehículo completa su `curb_weight_kg` y su GVW real resulta ser, p. ej.,
 * 12 t (`camion_mediano` con `capacityKg` moderado), la vía 1 (GVW)
 * reclasificaría la configuración como `MDV`. Esto es una RECLASIFICACIÓN
 * hacia una categoría con menor α (0.10 vs 0.15) — el certificado GLEC de
 * viajes futuros de ese vehículo bajará su factor de corrección por carga
 * al completarse el dato. W4c (el orquestador que arma la configuración
 * efectiva desde `asignaciones`) debe tratar esto como esperado y
 * documentado, no como un bug de inconsistencia entre certificados.
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
 *
 * @param configuracion Configuración efectiva del servicio (motriz + 0..1 arrastre).
 * @param tipoVehiculoLegacy Fallback opcional para cuando `curbWeightKg`
 *   motriz es `null` — tipo legacy (`ParametrosPorDefecto['tipoVehiculo']`)
 *   a pasar a `categoriaVehiculo()`. Ignorado si `curbWeightKg` está
 *   presente (el GVW real siempre gana) o si hay arrastre (siempre HDV).
 * @throws {Error} si `curbWeightKg` motriz es `null`, no hay arrastre, y no
 *   se proporcionó `tipoVehiculoLegacy` — nunca se inventa `curb=0` ni se
 *   devuelve una categoría por defecto en silencio.
 */
export function categoriaPorConfiguracion(
  configuracion: ConfiguracionViaje,
  tipoVehiculoLegacy?: ParametrosPorDefecto['tipoVehiculo'],
): CategoriaVehiculo {
  if (configuracion.arrastre) {
    return 'HDV';
  }

  const { curbWeightKg, capacityKg } = configuracion.motriz;

  if (curbWeightKg == null) {
    if (tipoVehiculoLegacy != null) {
      return categoriaVehiculo(tipoVehiculoLegacy);
    }
    throw new Error(
      'categoriaPorConfiguracion: curbWeightKg motriz es null y no se proporcionó ' +
        'tipoVehiculoLegacy de fallback (I2/ADR-073 — nunca se asume curbWeightKg=0)',
    );
  }

  const gvwTon = (curbWeightKg + capacityKg) / 1000;
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
