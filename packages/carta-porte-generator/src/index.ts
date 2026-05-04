/**
 * @booster-ai/carta-porte-generator
 *
 * Generador de Carta de Porte chilena conforme **Ley 18.290 del Tránsito
 * Art. 174**. Produce un PDF A4 portrait con todos los campos legales
 * mínimos: remitente, transportista, conductor, vehículo, ruta, cargas
 * detalladas, observaciones, y referencia de verificación online.
 *
 * El PDF generado NO viene firmado digitalmente — la firma KMS es
 * responsabilidad del caller (`apps/document-service`) usando
 * `packages/certificate-generator/firmar-pades`.
 *
 * @example
 * ```ts
 * import { generarCartaPorte } from '@booster-ai/carta-porte-generator';
 *
 * const { pdfBuffer, sha256, sizeBytes } = await generarCartaPorte({
 *   trackingCode: 'BOO-ABC123',
 *   fechaEmision: new Date(),
 *   fechaSalida: new Date(Date.now() + 3600_000),
 *   remitente: { ... },
 *   transportista: { ... },
 *   conductor: { ... },
 *   vehiculo: { ... },
 *   origen: { ... },
 *   destino: { ... },
 *   cargas: [{ ... }],
 * });
 * ```
 *
 * Ver:
 * - ADR-007 (Chile Document Management) — sección "Carta de Porte (generación)"
 * - Ley 18.290 Art. 174 — https://bcn.cl/2f72s
 */

export type {
  CartaPorteInput,
  CartaPorteResult,
  EmpresaInfo,
  ConductorInfo,
  VehiculoInfo,
  Ubicacion,
  CargaInfo,
} from './types.js';

export {
  cartaPorteInputSchema,
  empresaInfoSchema,
  conductorInfoSchema,
  vehiculoInfoSchema,
  ubicacionSchema,
  cargaInfoSchema,
} from './types.js';

export {
  CartaPorteError,
  CartaPorteValidationError,
  CartaPorteRenderError,
} from './errors.js';

export { generarCartaPorte } from './generar.js';

export { CartaPorteDocument } from './pdf-document.js';
