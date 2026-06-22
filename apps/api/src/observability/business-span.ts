import {
  type AttributeValue,
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

/**
 * Helper para envolver operaciones de NEGOCIO con un span OpenTelemetry
 * (gap F-09 del audit 2026-06; CLAUDE.md §Observabilidad: "cada operación
 * de negocio tiene span OTel").
 *
 * El bootstrap (`@booster-ai/otel-bootstrap` vía `instrumentation.ts`) ya
 * instala la auto-instrumentación HTTP/DB; eso genera spans de INFRA
 * (request entrante, query Drizzle) pero NO spans de DOMINIO. Sin un span
 * propio, un `runMatching` o un `cobraHoy` queda invisible como unidad de
 * negocio en Cloud Trace — solo se ven sus queries sueltas. Este helper
 * cierra ese hueco con la mínima ceremonia y un manejo de error correcto.
 *
 * Contrato (alineado con la spec del SDK OTel):
 *   - Crea un span ACTIVO (`startActiveSpan`) → los spans hijos que generen
 *     las queries Drizzle / HTTP salientes cuelgan de él automáticamente.
 *   - Aplica atributos al inicio (los que se conocen sin ejecutar) y permite
 *     enriquecer con más atributos vía el callback `(span) => ...`.
 *   - En error: `recordException` + `setStatus(ERROR)` y **re-throw** — jamás
 *     traga el error (regla "no silently swallow errors"). El logger
 *     estructurado existente del service sigue siendo la fuente primaria; el
 *     span COMPLEMENTA, no reemplaza.
 *   - Siempre `span.end()` (vía finally), incluso en el camino de error.
 *
 * Atributos: SOLO no sensibles (ids, versión de algoritmo, estado/resultado,
 * conteos, montos en CLP). NUNCA PII (nombres, RUT, teléfonos, direcciones)
 * ni secretos. El `RedactingSpanExporter` redacta credenciales en URLs, pero
 * la primera línea de defensa es no ponerlas en los atributos.
 *
 * En dev/test no hay `TracerProvider` registrado → `startActiveSpan` usa el
 * tracer no-op del SDK: el callback se ejecuta igual y el span no hace nada.
 * Por eso instrumentar no rompe ningún test existente.
 */

/** Namespace estable para los atributos de negocio Booster. */
export const BUSINESS_SPAN_TRACER = 'booster-ai-api/business';

/**
 * Valores de atributo permitidos por OTel, más `undefined` para poder pasar
 * campos opcionales sin un `if` por cada uno (los `undefined` se descartan).
 */
export type SpanAttributeInput = AttributeValue | undefined;

/** Limpia un mapa de atributos descartando las claves con valor `undefined`. */
function cleanAttributes(attributes: Record<string, SpanAttributeInput>): Attributes {
  const cleaned: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export interface WithBusinessSpanOptions {
  /**
   * Nombre del span. Convención: `<dominio>.<operacion>` en snake/dot, ej.
   * `matching.run`, `offer.accept`, `factoring.cobra_hoy`.
   */
  name: string;
  /** Atributos conocidos ANTES de ejecutar (ids de entrada, versión, flags). */
  attributes?: Record<string, SpanAttributeInput>;
}

/**
 * Ejecuta `fn` dentro de un span activo. `fn` recibe el span para enriquecerlo
 * con atributos de RESULTADO (conteos, estado final, montos) vía
 * `setResultAttributes` antes de retornar.
 */
export async function withBusinessSpan<T>(
  options: WithBusinessSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(BUSINESS_SPAN_TRACER);
  return await tracer.startActiveSpan(options.name, async (span) => {
    if (options.attributes) {
      span.setAttributes(cleanAttributes(options.attributes));
    }
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Azúcar para setear atributos de resultado descartando `undefined`. Pensado
 * para llamarse desde dentro del callback de `withBusinessSpan`, justo antes
 * del `return`, con los valores que solo se conocen tras ejecutar la lógica
 * (conteos finales, estado terminal, ids generados, montos calculados).
 */
export function setResultAttributes(
  span: Span,
  attributes: Record<string, SpanAttributeInput>,
): void {
  span.setAttributes(cleanAttributes(attributes));
}
