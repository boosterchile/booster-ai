import type { ParametrosGenerarPdf } from '../src/generar-pdf-base.js';
const viaje = {
  trackingCode: 'BOO-HC7DJX',
  origenDireccion: 'Av. Apoquindo 5400, Las Condes',
  origenRegionCode: 'XIII',
  destinoDireccion: 'Calle 1 Norte 123, Concepción',
  destinoRegionCode: 'VIII',
  cargoTipo: 'carga_seca',
  cargoPesoKg: 12000,
  pickupAt: null,
  deliveredAt: new Date('2026-10-30T18:00:00Z'),
  version: { numero: 2, reemplazaA: 1 },
};
const metricas = {
  distanciaKmEstimated: 468.76,
  distanciaKmActual: 468.76,
  kgco2eWtwEstimated: 429.246,
  kgco2eWtwActual: null,
  kgco2eTtw: 353.73,
  kgco2eWtt: 75.515,
  combustibleConsumido: 132.48,
  combustibleUnidad: 'L' as const,
  intensidadGco2ePorTonKm: 183.14,
  precisionMethod: 'modelado' as const,
  glecVersion: 'v3.0',
  emissionFactorUsado: 3.24,
  fuenteFactores:
    'GLEC Framework v2.0 (2019), ISBN 978-90-82-68790-3, Módulo 1, Tabla 32 (EU), p. 87',
  calculatedAt: new Date('2026-11-02T19:00:00Z'),
  routeDataSource: 'teltonika_gps' as const,
  coveragePct: 60.9,
  certificationLevel: 'secundario_modeled' as const,
  uncertaintyFactor: 0.05,
  factorMatchingAplicado: 0.5,
  ahorroCo2eVsSinMatchingKgco2eWtw: 40,
};
const base: ParametrosGenerarPdf = {
  viaje,
  metricas,
  empresaShipper: { id: 'x', legalName: 'Logística del Sur SpA', rut: '76.123.456-K' },
  transportista: {
    legalName: 'Transportes Ejemplo Ltda.',
    rut: '77.000.000-1',
    vehiclePlate: 'KZXB64',
  },
  verifyUrl: 'https://api.boosterchile.com/certificates/BOO-HC7DJX/verify',
};
/** Dirección chilena real de 112 caracteres (QA #873). */
export const DIRECCION_112 =
  'Avenida Libertador Bernardo O’Higgins 3363, Departamento 1204, Torre B-2, Estación Central, Región Metropolitana';
export const CARGA_EXTREMA = `carga_${'X'.repeat(120)}_refrigerada_peligrosa_${'muy_larga_'.repeat(6)}<script>"()\\`;
/** URL de verificación de 200+ caracteres (QA #873 v2: mata el mutante sin wrap). */
export const URL_LARGA = `https://api.boosterchile.com/certificates/BOO-HC7DJX/verify?firma=${'a1b2c3d4'.repeat(20)}`;
/** Unidad de combustible larga: alarga la línea de detalle de Resultados. */
const UNIDAD_LARGA = 'litros de diésel equivalente medidos por CAN bus del vehículo' as 'L';
/** Datos de usuario con saltos de línea y tabs (formularios / bot). */
export const DIRECCION_MULTILINEA = 'Av. Apoquindo 5400\nDepto. 1204\r\nLas Condes\t\tSantiago';
export const CARGA_MULTILINEA = 'carga\nseca\r\nrefrigerada\npaletizada';
const A300 = 'A'.repeat(300);
export const CASOS: Record<string, ParametrosGenerarPdf> = {
  normal: base,
  largo: {
    ...base,
    viaje: { ...viaje, origenDireccion: DIRECCION_112, destinoDireccion: DIRECCION_112 },
    empresaShipper: {
      ...base.empresaShipper,
      legalName:
        'Sociedad Comercializadora y Distribuidora de Productos Agrícolas del Valle Central Limitada',
    },
    metricas: { ...metricas, combustibleUnidad: UNIDAD_LARGA },
    verifyUrl: URL_LARGA,
  },
  multilinea: {
    ...base,
    viaje: {
      ...viaje,
      origenDireccion: DIRECCION_MULTILINEA,
      destinoDireccion: 'Calle 1 Norte 123\n\nConcepción',
      cargoTipo: CARGA_MULTILINEA,
    },
  },
  /** Réplica del caso «extremo» de QA (qa/qa873v1-extremo-*.png). */
  extremo: {
    ...base,
    viaje: {
      ...viaje,
      origenDireccion: A300,
      destinoDireccion: 'Línea 1 del destino\nLínea 2 del destino\nLínea 3 del destino',
      cargoTipo: A300,
    },
    empresaShipper: { id: 'x', legalName: 'Empresa Extrema '.repeat(47), rut: A300 },
    transportista: { legalName: 'Transportes Extremos Ltda.', rut: A300, vehiclePlate: A300 },
  },
  raro: {
    ...base,
    viaje: { ...viaje, cargoTipo: CARGA_EXTREMA, origenDireccion: `Calle ${'Ñ'.repeat(140)}` },
    empresaShipper: {
      ...base.empresaShipper,
      legalName: 'Empresa\u200f\u0007 «rara» (S.A.) \\ "comillas" '.repeat(4),
    },
    transportista: { legalName: 'T'.repeat(150), rut: '77.000.000-1', vehiclePlate: 'KZXB64' },
  },
};

/**
 * Casos que empujan el contenido hasta el pie: el origen crece de a ~2,5 líneas (0 a 40)
 * para que, en alguno, un bloque quede justo sobre PISO (mata PISO=10).
 */
export function casosLlenos(): ParametrosGenerarPdf[] {
  return Array.from({ length: 16 }, (_, k) => ({
    ...base,
    viaje: { ...viaje, origenDireccion: `${'Calle Larga Número '.repeat(10 * k)}123` },
  }));
}
