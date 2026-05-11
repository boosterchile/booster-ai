import type { DteResult, DteStatus, FacturaInput, GuiaDespachoInput } from './types.js';

/**
 * Contrato neutral del package @booster-ai/dte-provider (ADR-024 §2).
 *
 * Todas las implementaciones (SovosAdapter, BsaleAdapter, MockAdapter,
 * futuros) cumplen este contrato. Los services en `apps/api` operan
 * exclusivamente contra esta interfaz — nunca importan adapters
 * específicos — para que el provider activo sea config-swap (env
 * `DTE_PROVIDER=sovos|bsale|mock`).
 *
 * **Idempotencia esperada por contrato**:
 *   - `emitFactura` / `emitGuiaDespacho`: el adapter NO necesita ser
 *     idempotente por payload — el caller (service) garantiza
 *     idempotencia via UNIQUE en la tabla liquidaciones/trips (un
 *     trip solo dispara una emisión por tipo).
 *   - `queryStatus`: idempotente por naturaleza (lectura).
 *   - `voidDocument`: idempotente — si el folio ya está anulado,
 *     el adapter debe retornar success sin emitir nota crédito nueva.
 *
 * **Errores**: ver `errors.ts`. Cada adapter traduce errores
 * específicos del provider a una clase canónica (`DteNotConfiguredError`,
 * `DteValidationError`, `DteTransientError`, `DteProviderRejectedError`).
 */
export interface DteEmitter {
  /**
   * Emite Factura Electrónica (DTE 33). Para Booster: emitida por
   * Booster al carrier por concepto de comisión + IVA de la
   * liquidación (ADR-031 §4.1).
   *
   * @throws DteNotConfiguredError si el adapter no tiene creds.
   * @throws DteValidationError si el input falla schema validation.
   * @throws DteTransientError si el provider retorna 5xx/timeout.
   * @throws DteProviderRejectedError si SII rechaza el documento.
   */
  emitFactura(input: FacturaInput): Promise<DteResult>;

  /**
   * Emite Guía de Despacho Electrónica (DTE 52). Para Booster:
   * emitida por el carrier al generador por el monto bruto del
   * viaje. Ley 18.290 art. 1°.
   */
  emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult>;

  /**
   * Consulta el status actual de un DTE en SII vía el provider.
   * Idempotente por naturaleza. Útil para reconciliar post-emisión
   * cuando el provider devolvió `en_proceso`.
   */
  queryStatus(folio: string, rutEmisor: string): Promise<DteStatus>;

  /**
   * Emite una Nota Crédito Electrónica (DTE 61) referenciando el
   * folio original por el monto total — efectivamente anula el DTE.
   * El adapter es responsable de:
   *   - Verificar que el folio existe y no está ya anulado.
   *   - Construir el payload de nota crédito con TpoDocRef = tipo
   *     original + FolioRef = folio.
   *   - Retornar success si el folio ya estaba anulado (idempotencia).
   */
  voidDocument(folio: string, rutEmisor: string, reason: string): Promise<void>;
}
