/**
 * @booster-ai/factoring-engine
 *
 * Foundation técnica de factoring v1 (ADR-029 + ADR-032).
 *
 * Funciones puras (sin I/O):
 *   - `calcularTarifaProntoPago(input)`: tarifa + monto adelantado para
 *     un viaje según el plazo del shipper.
 *   - `evaluarShipper(params)`: underwriting con reglas hard (RUT, antigüedad,
 *     morosidad) + score Equifax para auto-aprobación.
 *
 * Constantes:
 *   - `FACTORING_METHODOLOGY_VERSION`: semver capturada en cada adelanto.
 */

export { calcularTarifaProntoPago, FACTORING_METHODOLOGY_VERSION } from './tarifa.js';
export { evaluarShipper } from './underwriting.js';
export type {
  CalcularTarifaInput,
  CalcularTarifaOutput,
  EvaluarShipperInput,
  EvaluarShipperOutput,
  EvaluarShipperParams,
} from './types.js';
export {
  ESTADO_PAGO_INICIAL,
  TransicionPagoInvalidaError,
  calcularFloat,
  diasEntre,
  montosEsperados,
  reducirPagoViaje,
  revisarVencimientos,
  validarEvento,
  vencimientos,
  verificarTopeFloat,
} from './mandato-cobro.js';
export type {
  CodigoRechazoPago,
  ContextoValidacion,
  EstadoCobro,
  EstadoLiberacion,
  EventoPago,
  LineaPago,
  PagoViaje,
  PlazosMandato,
  ResultadoValidacion,
  TipoEventoPago,
} from './mandato-cobro.js';
