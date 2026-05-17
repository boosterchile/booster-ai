/**
 * @booster-ai/shared-schemas — k-anonymity invariant (D11 / ADR-041).
 *
 * Helper puro: dada una lista de buckets de agregación, reemplaza los
 * campos métricos (numéricos) de cada bucket cuyo `countField` sea < k
 * por `null`. Las dimensiones (campos no-numéricos o numéricos listados
 * en `preserveFields`) se mantienen para que la UI muestre "Sin data
 * suficiente" en la celda correcta — sin perder la identidad del bucket.
 *
 * Devuelve un array nuevo — no muta el input. Pensado para correr
 * server-side antes de serializar la respuesta del endpoint.
 */

/**
 * Misma forma que `T` pero campos numéricos posiblemente `null` runtime.
 */
export type KAnonymized<T> = {
  [K in keyof T]: T[K] extends number ? T[K] | null : T[K];
};

export interface KAnonymityOptions<T> {
  /**
   * Campos numéricos que son dimensiones (e.g. `hora` 0..23) — se
   * preservan aún cuando count < k. Default: ninguno; todos los campos
   * numéricos se nullean.
   */
  preserveFields?: ReadonlyArray<keyof T>;
}

export function aplicarKAnonymity<T extends Record<string, unknown>>(
  buckets: readonly T[],
  k: number,
  countField: keyof T,
  options: KAnonymityOptions<T> = {},
): KAnonymized<T>[] {
  const preserve = new Set<keyof T>(options.preserveFields ?? []);
  return buckets.map((bucket) => {
    const count = bucket[countField];
    if (typeof count !== 'number' || count >= k) {
      return { ...bucket } as KAnonymized<T>;
    }
    const masked: Record<string, unknown> = { ...bucket };
    for (const key of Object.keys(masked)) {
      if (!preserve.has(key as keyof T) && typeof masked[key] === 'number') {
        masked[key] = null;
      }
    }
    return masked as KAnonymized<T>;
  });
}
