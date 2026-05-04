/**
 * @booster-ai/dte-provider
 *
 * Abstracción sobre proveedores DTE acreditados SII Chile (Paperless,
 * Bsale, etc.). Ver ADR-007 §"Integración SII DTE" + ADR-015 §"Paperless
 * seleccionado".
 *
 * Uso:
 *
 *   import { createDteEmitter } from '@booster-ai/dte-provider';
 *
 *   const emitter = createDteEmitter({
 *     provider: 'paperless',
 *     apiKey: env.PAPERLESS_API_KEY,
 *     baseUrl: env.PAPERLESS_BASE_URL,
 *   });
 *
 *   const result = await emitter.emitGuiaDespacho({
 *     rutEmisor: '76543210-3',
 *     receptor: { rut, razonSocial, giro, direccion, ... },
 *     items: [...],
 *     origen: { direccion, comuna },
 *     destino: { direccion, comuna },
 *     patenteVehiculo: 'AB1234',
 *     rutConductor: '11111111-1',
 *     idempotencyKey: `gd-${tripId}`,
 *   });
 *
 *   // result.folio, result.providerRef, result.pdfUrl, result.status
 */

export { createDteEmitter } from './factory.js';
export type { DteProviderConfig } from './factory.js';
export { MockAdapter } from './mock-adapter.js';
export type { MockAdapterOptions } from './mock-adapter.js';
export { PaperlessAdapter } from './paperless-adapter.js';
export type { HttpClient, PaperlessAdapterOptions } from './paperless-adapter.js';
export type { DteEmitter } from './dte-emitter.js';
export {
  DteProviderError,
  DteValidationError,
  dteLineItemSchema,
  dteReceptorSchema,
  dteResultSchema,
  dteStatusSchema,
  dteTypeSchema,
  facturaInputSchema,
  guiaDespachoInputSchema,
  type DteLineItem,
  type DteReceptor,
  type DteResult,
  type DteStatus,
  type DteType,
  type FacturaInput,
  type GuiaDespachoInput,
} from './tipos.js';
