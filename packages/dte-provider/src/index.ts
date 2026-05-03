/**
 * @booster-ai/dte-provider
 *
 * Abstracción de proveedores de Documentos Tributarios Electrónicos (DTE)
 * para el SII chileno. Implementa el adapter pattern definido en ADR-007.
 *
 * Booster NO emite DTEs propios — delega a un provider acreditado por SII
 * (Bsale recomendado, alternativas: Paperless, Acepta, SovosChile). Este
 * package define:
 *
 *   1. La **interface** `DteProvider` que cada adapter implementa.
 *   2. **Schemas Zod** para validar inputs y outputs antes de cruzar la
 *      frontera HTTP del provider externo (CLAUDE.md §5 + §7).
 *   3. **Errores tipados** que el caller mapea a HTTP status apropiados.
 *   4. Una implementación **`MockDteProvider`** in-memory para dev local
 *      y tests, sin dependencia del provider real.
 *
 * El switch a un provider real (Bsale → Paperless u otro) es cambiar la
 * factory en `apps/document-service` — el resto del código consume la
 * interface, no la implementación concreta.
 *
 * Ver:
 * - ADR-007 (Chile Document Management) — sección "Integración SII DTE"
 * - HANDOFF.md §4 — bloqueante regulatorio go-live Chile
 *
 * @example
 * ```ts
 * import {
 *   MockDteProvider,
 *   type DteProvider,
 * } from '@booster-ai/dte-provider';
 *
 * const provider: DteProvider = new MockDteProvider();
 * const result = await provider.emitGuiaDespacho({
 *   rutEmisor: '76123456-7',
 *   razonSocialEmisor: 'Transportes Chile SpA',
 *   rutReceptor: '12345678-9',
 *   razonSocialReceptor: 'Cliente SA',
 *   fechaEmision: new Date(),
 *   items: [{
 *     descripcion: 'Transporte Santiago → Concepción',
 *     cantidad: 1,
 *     precioUnitarioClp: 850000,
 *     unidadMedida: 'VIAJE',
 *   }],
 *   transporte: {
 *     rutChofer: '11111111-1',
 *     nombreChofer: 'Juan Pérez',
 *     patente: 'AB-CD-12',
 *     direccionDestino: 'Av. Principal 123, Concepción',
 *     comunaDestino: 'Concepción',
 *   },
 * });
 * console.log(result.folio); // SII-asignado (mock: 1, 2, 3, ...)
 * ```
 */

export type {
  DteProvider,
  DteStatus,
  DteEnvironment,
  DteResult,
  GuiaDespachoInput,
  FacturaInput,
  DteItem,
  TransporteInfo,
} from './types.js';

export {
  guiaDespachoInputSchema,
  facturaInputSchema,
  dteResultSchema,
  dteStatusSchema,
  dteItemSchema,
  transporteInfoSchema,
} from './types.js';

export {
  DteProviderError,
  DteValidationError,
  DteRejectedBySiiError,
  DteProviderUnavailableError,
  DteFolioConflictError,
  DteCertificateError,
  DteNotFoundError,
} from './errors.js';

export { MockDteProvider, type MockDteProviderOptions } from './mock.js';
