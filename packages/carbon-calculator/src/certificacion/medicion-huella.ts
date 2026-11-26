import type { MetodoPrecision, NivelCertificacion, RouteDataSource } from '../tipos.js';
import { THRESHOLD_PRIMARIO_PCT, THRESHOLD_SECUNDARIO_MODELED_PCT } from './derivar-nivel.js';

/**
 * Qué se midió en un viaje y qué le falta para llegar a primario verificable
 * (`.specs/frente2-cierre` §3.1). Función pura: la usa el API para que la web
 * muestre la tabla de lo medido y el nivel sin reconstruir vocabulario.
 *
 * Vocabulario (ADR-077 §4, ADR-091 §3): «medido» se dice de la distancia que
 * midió un dispositivo y del consumo que midió el CAN; el consumo calculado es
 * «modelado»; el peso es siempre «declarado» (`.specs/medicion-huella-segmento`
 * Q1). Lo que no viene de una fuente propia del viaje es «estimado».
 */
export type ClaseMedicion = 'medido' | 'modelado' | 'declarado' | 'estimado' | 'sin_dato';

export interface FilaMedicion {
  magnitud: 'distancia' | 'combustible' | 'peso';
  fuente: string;
  clase: ClaseMedicion;
}

export interface NivelExplicado {
  nivel: NivelCertificacion | null;
  nombre: string;
  /** Lo que faltaría para llegar a primario verificable; vacío en primario. */
  falta: string[];
  frase: string;
}

export interface MedicionHuella {
  filas: FilaMedicion[];
  nivel: NivelExplicado;
}

const NOMBRE_NIVEL: Record<NivelCertificacion, string> = {
  primario_verificable: 'Primario verificable',
  secundario_modeled: 'Secundario modelado',
  secundario_default: 'Secundario por defecto',
};

/** La cobertura no sube: 94,9 % es 94 % (misma regla que el certificado). */
function piso(coveragePct: number | null): number {
  return Math.min(100, Math.max(0, Math.floor(coveragePct ?? 0)));
}

function distancia(
  routeDataSource: RouteDataSource | null,
  coveragePct: number | null,
): FilaMedicion {
  const pct = piso(coveragePct);
  switch (routeDataSource) {
    case 'teltonika_gps':
      return (coveragePct ?? 0) >= THRESHOLD_SECUNDARIO_MODELED_PCT
        ? {
            magnitud: 'distancia',
            fuente: `Teltonika del camión (cobertura ${pct} %)`,
            clase: 'medido',
          }
        : {
            magnitud: 'distancia',
            fuente: `Ruta calculada: el Teltonika cubrió ${pct} %, bajo el ${THRESHOLD_SECUNDARIO_MODELED_PCT} %`,
            clase: 'estimado',
          };
    case 'movil_gps':
      return {
        magnitud: 'distancia',
        fuente: `GPS del teléfono del conductor (cobertura ${pct} %)`,
        clase: 'medido',
      };
    case 'maps_directions':
      return {
        magnitud: 'distancia',
        fuente: 'Ruta calculada con Google Routes',
        clase: 'estimado',
      };
    case 'manual_declared':
      return { magnitud: 'distancia', fuente: 'Declarada en la carga', clase: 'declarado' };
    default:
      return { magnitud: 'distancia', fuente: 'Sin dato', clase: 'sin_dato' };
  }
}

function combustible(precisionMethod: MetodoPrecision | null): FilaMedicion {
  switch (precisionMethod) {
    case 'exacto_canbus':
      return { magnitud: 'combustible', fuente: 'CAN del camión', clase: 'medido' };
    case 'modelado':
      return {
        magnitud: 'combustible',
        fuente: 'Modelo GLEC v3.0 con el perfil del vehículo',
        clase: 'modelado',
      };
    case 'por_defecto':
      return {
        magnitud: 'combustible',
        fuente: 'Valor por defecto del tipo de vehículo (GLEC v3.0)',
        clase: 'estimado',
      };
    default:
      return { magnitud: 'combustible', fuente: 'Sin dato', clase: 'sin_dato' };
  }
}

function peso(pesoDeclaradoKg: number | null): FilaMedicion {
  if (pesoDeclaradoKg == null || !(pesoDeclaradoKg > 0)) {
    return { magnitud: 'peso', fuente: 'Sin peso declarado', clase: 'sin_dato' };
  }
  const kg = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(pesoDeclaradoKg);
  return { magnitud: 'peso', fuente: `Declarado en la carga (${kg} kg)`, clase: 'declarado' };
}

function nivel(input: {
  precisionMethod: MetodoPrecision | null;
  routeDataSource: RouteDataSource | null;
  coveragePct: number | null;
  certificationLevel: NivelCertificacion | null;
}): NivelExplicado {
  const actual = input.certificationLevel;
  const nombre = actual ? NOMBRE_NIVEL[actual] : 'Sin nivel';
  if (actual === 'primario_verificable') {
    return {
      nivel: actual,
      nombre,
      falta: [],
      frase: 'Es el nivel más alto: la huella fue medida.',
    };
  }
  // ADR-028 §2: primario exige distancia del Teltonika con 95 % o más y
  // consumo medido por el CAN. El teléfono nunca llega (ADR-077 §2).
  const falta: string[] = [];
  if (input.routeDataSource !== 'teltonika_gps') {
    falta.push('medir la distancia con un Teltonika instalado en el camión');
  } else if ((input.coveragePct ?? 0) < THRESHOLD_PRIMARIO_PCT) {
    falta.push(
      `cobertura del Teltonika de ${THRESHOLD_PRIMARIO_PCT} % o más (este viaje: ${piso(input.coveragePct)} %)`,
    );
  }
  if (input.precisionMethod !== 'exacto_canbus') {
    falta.push('medir el consumo con el CAN del camión');
  }
  const frase =
    falta.length === 0
      ? 'Cumple lo que pide el nivel primario; se asigna al cerrar el viaje.'
      : `Para llegar a primario verificable falta ${falta.join(' y ')}.`;
  return { nivel: actual, nombre, falta, frase };
}

export function medicionHuella(input: {
  precisionMethod: MetodoPrecision | null;
  routeDataSource: RouteDataSource | null;
  /** Cobertura de la fuente de posición, [0..100]. */
  coveragePct: number | null;
  certificationLevel: NivelCertificacion | null;
  pesoDeclaradoKg: number | null;
}): MedicionHuella {
  return {
    filas: [
      distancia(input.routeDataSource, input.coveragePct),
      combustible(input.precisionMethod),
      peso(input.pesoDeclaradoKg),
    ],
    nivel: nivel(input),
  };
}
