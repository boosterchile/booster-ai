/**
 * @booster-ai/dte-provider — adapter-pattern para emisión de DTEs
 * en Chile (ADR-024), con expansión LATAM pre-validada.
 *
 * El package es **provider-agnostic**: los services en apps/api
 * importan únicamente la interfaz `DteEmitter` y un adapter
 * concreto que se inyecta por env (`DTE_PROVIDER=sovos|mock`).
 *
 * Estado de implementación:
 *   - Interface + types Zod-validados ✅
 *   - Errors canónicos ✅
 *   - MockAdapter (dev + tests) ✅
 *   - SovosAdapter skeleton ✅ (pendiente sandbox UAT para shape exacto)
 *   - BsaleAdapter ⏳ (degraded mode 1-RUT, post-Sovos)
 *   - DefontanaAdapter ⏳ (Chile alternativo, multi-país regional)
 *   - AlanubeAdapter ⏳ (Colombia primario)
 *   - EdicomAdapter ⏳ (México primario)
 */

export type { DteEmitter } from './interface.js';
export type {
  DteResult,
  DteStatus,
  DteStatusValue,
  DteTipo,
  FacturaInput,
  GuiaDespachoInput,
  Item,
} from './types.js';
export {
  dteResultSchema,
  dteStatusSchema,
  dteStatusValueSchema,
  dteTipoSchema,
  facturaInputSchema,
  guiaDespachoInputSchema,
  itemSchema,
  rutSchema,
} from './types.js';
export {
  DteNotConfiguredError,
  DteProviderError,
  DteProviderRejectedError,
  DteTransientError,
  DteValidationError,
} from './errors.js';
export { MockDteAdapter } from './adapters/mock.js';
export { SovosDteAdapter, type SovosAdapterOpts } from './adapters/sovos.js';

export const PACKAGE_NAME = '@booster-ai/dte-provider' as const;
