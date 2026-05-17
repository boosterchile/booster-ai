/**
 * @booster-ai/shared-schemas — k-anonymity invariant (D11 / ADR-041, ADR-042).
 *
 * Helper puro: garantiza k-anonymity ≥ k en buckets de agregación.
 *
 * Modo por defecto (`dropSubKBuckets: false`): enmascara TODOS los
 * campos no listados en `preserveFields` (incluidos strings y
 * booleans, no solo números). Los strings son quasi-identifiers que
 * combinados con conocimiento externo permiten reidentificación
 * (e.g. `{tipo: 'gnv', viajes: null}` revela "hay actividad GNV" →
 * identifica al único shipper GNV de la zona).
 *
 * Modo `dropSubKBuckets: true`: filtra del output los buckets con
 * `count < k` en vez de enmascararlos. Usar cuando la presencia
 * misma del bucket leak información — e.g. `por_tipo_carga`,
 * `por_combustible` donde la clave de agrupación es el identificador.
 *
 * Throw si k < 2: k=0 o k=1 no provee garantía de anonimato.
 * Estándar industria k ≥ 5 (Samarati 1998). Permitimos k=2..4 solo
 * para flexibilidad de tests.
 *
 * Fail-closed: si `countField` no es número finito (NaN, Infinity,
 * undefined, string), el bucket se trata como riesgoso → se enmascara
 * (o se filtra si `dropSubKBuckets`). NUNCA se asume seguro por
 * silencio.
 *
 * Devuelve array nuevo — no muta el input. Pensado para correr
 * server-side antes de serializar la respuesta del endpoint.
 */

/**
 * Misma forma que `T` pero cualquier campo puede ser `null` runtime
 * (excepto los listados en `preserveFields` del caller, que se
 * preservan literalmente — pero el tipo no lo refleja sin runtime info).
 */
export type KAnonymized<T> = {
  [K in keyof T]: T[K] | null;
};

export interface KAnonymityOptions<T> {
  /**
   * Dimensiones legítimas que se preservan aún cuando `count < k`.
   * Incluí solo campos que NO leakean PII en combinación con
   * conocimiento externo. Ejemplos seguros: `hora` (0..23), `dia_semana`
   * (0..6). Ejemplos NO seguros (NO incluir aquí): `slug` de zona,
   * `tipo_carga`, `fuel_type` — esos identifican.
   *
   * Default: ninguno (todos los campos no-countField se nullean).
   */
  preserveFields?: ReadonlyArray<keyof T>;

  /**
   * Si `true`, los buckets con `count < k` o `count` no-finito se
   * eliminan del output (en vez de ser enmascarados). Usar cuando la
   * clave de agrupación del bucket es por sí sola un quasi-identifier.
   *
   * Default: `false` (modo enmascarar).
   *
   * Convención por surface D11:
   * - `por_hora_del_dia` → `dropSubKBuckets: false` + `preserveFields: ['hora']`
   *   (las 24 horas son universo cerrado, presencia no leak; perdemos
   *   solo el valor numérico).
   * - `por_tipo_carga` → `dropSubKBuckets: true` (presencia de tipo leak).
   * - `por_combustible` → `dropSubKBuckets: true` (presencia de fuel leak).
   */
  dropSubKBuckets?: boolean;
}

export function aplicarKAnonymity<T extends Record<string, unknown>>(
  buckets: readonly T[],
  k: number,
  countField: keyof T,
  options: KAnonymityOptions<T> = {},
): KAnonymized<T>[] {
  if (!Number.isInteger(k) || k < 2) {
    throw new Error(
      `aplicarKAnonymity: k debe ser entero >= 2 (recibido ${String(k)}). k=0 o k=1 no provee garantía de anonimato. Estándar industria: k >= 5 (Samarati 1998).`,
    );
  }
  const preserve = new Set<keyof T>(options.preserveFields ?? []);
  const drop = options.dropSubKBuckets ?? false;
  const result: KAnonymized<T>[] = [];
  for (const bucket of buckets) {
    const count = bucket[countField];
    const countSafe = typeof count === 'number' && Number.isFinite(count) && count >= k;
    if (countSafe) {
      result.push({ ...bucket } as KAnonymized<T>);
      continue;
    }
    // Fail-closed: count < k, NaN, Infinity, undefined o no-numérico.
    if (drop) {
      continue;
    }
    result.push(maskAllExceptPreserve(bucket, preserve));
  }
  return result;
}

function maskAllExceptPreserve<T extends Record<string, unknown>>(
  bucket: T,
  preserve: Set<keyof T>,
): KAnonymized<T> {
  const masked: Record<string, unknown> = { ...bucket };
  for (const key of Object.keys(masked)) {
    if (!preserve.has(key as keyof T)) {
      masked[key] = null;
    }
  }
  return masked as KAnonymized<T>;
}
