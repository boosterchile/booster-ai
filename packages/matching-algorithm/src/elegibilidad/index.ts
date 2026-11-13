export {
  CARROCERIAS,
  COMPATIBILIDAD_CARGA_CARROCERIA,
  type Carroceria,
  TIPOS_DE_CARGA,
  type TipoDeCarga,
  carroceriaCompatible,
} from './tabla.js';
export {
  type CapacidadDeConfiguracion,
  type ConfiguracionElegible,
  type RequisitosDeCarga,
  TIPOS_DE_UNIDAD,
  type TipoDeUnidad,
  type UnidadDeFlota,
  capacidadDeConfiguracion,
  cargaCabeEnCarrocerias,
  componeConArrastre,
  configuracionesElegibles,
  empresaEsCandidata,
} from './configuraciones.js';
export {
  type CandidataPorCarga,
  type CandidataPorFlota,
  type ComparacionDeCandidatas,
  candidatasPorCarga,
  compararCandidatas,
} from './candidatas.js';
export {
  type ClaseVehiculoPorDefecto,
  claseMasChicaElegible,
  claseMasChicaQueCubre,
} from './clase-mas-chica.js';
