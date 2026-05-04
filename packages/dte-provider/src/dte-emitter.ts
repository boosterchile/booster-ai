/**
 * Interface principal del package — implementada por adapters concretos
 * (PaperlessAdapter, MockAdapter, futuros). Permite swap de provider
 * sin tocar dominio. Ver ADR-007 §"Integración SII DTE" + ADR-015.
 */

import type { DteResult, DteStatus, FacturaInput, GuiaDespachoInput } from './tipos.js';

export interface DteEmitter {
  /**
   * Emite una Guía de Despacho (DTE Tipo 52) vía el provider acreditado.
   * El provider firma con cert tributario, envía al SII, y devuelve el
   * folio asignado + URLs al XML firmado y PDF visual.
   *
   * Idempotencia: si `input.idempotencyKey` se provee, el provider
   * deduplica reintentos. Sin la key, dos invocaciones del mismo input
   * pueden emitir 2 DTEs distintos (y consumir 2 folios SII).
   *
   * Errores:
   *   - `DteValidationError`: SII o provider rechaza por contenido
   *     (RUT inválido, items mal formados, etc). NO retry.
   *   - `DteProviderError`: HTTP/network/timeout. Retry-safe si
   *     `idempotencyKey` está presente.
   */
  emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult>;

  /**
   * Emite una Factura Electrónica afecta (33) o exenta (34).
   * Misma semántica de idempotencia y errores que `emitGuiaDespacho`.
   */
  emitFactura(input: FacturaInput): Promise<DteResult>;

  /**
   * Consulta el estado actual del DTE. Útil porque el flujo SII es
   * asíncrono — un DTE puede estar `pendiente` por minutos hasta que
   * SII lo procesa. La capa caller suele encolarlo (Pub/Sub) y
   * actualizar la BD cuando el estado cambia.
   */
  queryStatus(folio: string, rutEmisor: string): Promise<DteStatus>;
}
