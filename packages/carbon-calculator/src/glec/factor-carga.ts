/**
 * Corrección del consumo según factor de carga.
 *
 * GLEC v3.0 §6.3: el consumo de combustible escala APROXIMADAMENTE
 * lineal con la masa total del vehículo (curb weight + carga). Modelos
 * más sofisticados (ACEA, COPERT) usan curvas según tipo de vehículo
 * y velocidad, pero para Chile-piloto la aproximación lineal es
 * suficientemente precisa (±10 % vs realidad).
 *
 * Reference fórmula:
 *
 *   consumoReal = consumoBase × (1 + alfa × (cargaKg / capacidadKg))
 *
 * Donde:
 *   - consumoBase: consumo declarado a "carga normal" (≈ 50 % capacidad)
 *   - alfa: sensibilidad del consumo a la carga
 *     - Camionetas/furgones: 0.05
 *     - Camiones medianos: 0.10
 *     - Camiones pesados/semi: 0.15
 *
 * Para mantener simplicidad usamos alfa = 0.10 universal en este piloto.
 * Cuando tengamos más datos de telemetría real, podemos calibrar por tipo.
 */

const ALFA_DEFAULT = 0.1;

/**
 * Devuelve el factor multiplicador a aplicar al consumo base según
 * la carga real vs capacidad nominal.
 *
 * - Si pesoVacio o capacidad son null o ≤ 0 → retorna 1 (sin corrección).
 * - Si la carga supera la capacidad → cap a 1.5× para evitar valores
 *   absurdos (puede pasar por errores de declaración).
 */
export function calcularFactorCorreccionPorCarga(opts: {
  cargaKg: number;
  capacidadKg: number;
  alfa?: number;
}): number {
  const { cargaKg, capacidadKg, alfa = ALFA_DEFAULT } = opts;
  if (capacidadKg <= 0) {
    return 1;
  }

  const ratio = Math.min(cargaKg / capacidadKg, 1.5);
  // ratio típico 0..1; con load factor 1 (vehículo lleno) → consumo +alfa
  // ratio 0 (vacío) → consumo (1 - alfa/2) — modelo simple, ajustable
  return 1 + alfa * (ratio - 0.5);
}
