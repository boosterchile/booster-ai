/**
 * Tipos de la ruta (ADR-088, spec ruta-parada-servicio §3 y §4).
 *
 * El paquete no conoce la base: recibe la ruta ya cargada y devuelve la ruta
 * resultante o los motivos del rechazo.
 */
import type { Carroceria, TipoDeCarga } from '@booster-ai/matching-algorithm';

export const ESTADOS_RUTA = ['planificada', 'en_curso', 'cerrada', 'cancelada'] as const;
export type EstadoRuta = (typeof ESTADOS_RUTA)[number];

export const TIPOS_PARADA = ['recogida', 'entrega'] as const;
export type TipoParada = (typeof TIPOS_PARADA)[number];

/** Una parada. Su orden es su posición en `Ruta.paradas`. */
export interface Parada {
  readonly servicioId: string;
  readonly tipo: TipoParada;
  /** La recogida o la entrega de esta parada ya se confirmó. */
  readonly resuelta: boolean;
}

/** Lo que la ruta necesita saber de cada servicio que lleva. */
export interface ServicioDeRuta {
  readonly servicioId: string;
  /** Empresa transportista de la asignación del servicio. */
  readonly empresaId: string;
  /** Para saber si la carrocería del vehículo le sirve (tabla de matching). */
  readonly tipoCarga: TipoDeCarga;
  readonly pesoKg: number | null;
  readonly volumenM3: number | null;
  readonly cancelado: boolean;
}

/**
 * La configuración declarada (motriz y arrastre, ADR-073): la capacidad de
 * las unidades que cargan y la carrocería de cada una. Se arma con
 * `capacidadDeConfiguracion` de matching-algorithm.
 */
export interface Configuracion {
  readonly capacidadKg: number;
  readonly capacidadM3: number | null;
  readonly carrocerias: readonly (Carroceria | null)[];
}

export interface Ruta {
  readonly empresaId: string;
  readonly estado: EstadoRuta;
  /** `null` mientras no se declara el vehículo. */
  readonly configuracion: Configuracion | null;
  readonly tieneConductor: boolean;
  readonly paradas: readonly Parada[];
  readonly servicios: readonly ServicioDeRuta[];
}

/** Trayecto entre dos paradas consecutivas. */
export interface Tramo {
  readonly desde: number;
  readonly hasta: number;
  readonly masaKg: number;
  /** `null` si algún servicio a bordo no declara volumen. */
  readonly volumenM3: number | null;
  readonly serviciosABordo: readonly string[];
  readonly vacio: boolean;
}

export const MOTIVOS_RECHAZO = [
  'paradas_del_servicio_invalidas',
  'entrega_antes_de_recogida',
  'capacidad_peso_excedida',
  'carroceria_incompatible',
  'en_curso_sin_vehiculo',
  'en_curso_sin_conductor',
  'servicio_de_otra_empresa',
  'servicio_sin_peso_en_ruta_consolidada',
  'ruta_no_editable',
  'servicio_ya_en_la_ruta',
  'servicio_no_esta_en_la_ruta',
  'recogida_antes_de_parada_resuelta',
  'servicio_ya_recogido',
  'servicio_cancelado',
  'servicio_unico_de_la_ruta',
  'vehiculo_con_carga_recogida',
  'rutas_de_distinta_empresa',
  'orden_invalido',
  'parada_resuelta_movida',
  'posicion_invalida',
] as const;
export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number];

export interface Violacion {
  readonly motivo: MotivoRechazo;
  readonly servicioId?: string;
  /** Índice del tramo (su parada de salida) cuando el motivo es de capacidad. */
  readonly tramo?: number;
  /** Con `capacidad_peso_excedida`: la masa a bordo del tramo y la capacidad. */
  readonly masaKg?: number;
  readonly capacidadKg?: number;
}

/**
 * Lo que no bloquea. El volumen declarado de la flota es poco confiable, así
 * que excederlo avisa y no rechaza (decisión D2 del plan, igual que en
 * matching-desde-la-carga §11-5).
 */
export const MOTIVOS_AVISO = ['capacidad_volumen_excedida'] as const;
export type MotivoAviso = (typeof MOTIVOS_AVISO)[number];

export interface Aviso {
  readonly motivo: MotivoAviso;
  readonly tramo: number;
  readonly volumenM3: number;
  readonly capacidadM3: number;
}

export type Resultado =
  | { readonly ok: true; readonly ruta: Ruta }
  | { readonly ok: false; readonly violaciones: readonly Violacion[] };

/** Mover un servicio toca dos rutas: el rechazo dice en cuál está el problema. */
export type ResultadoDeMover =
  | { readonly ok: true; readonly origen: Ruta; readonly destino: Ruta }
  | {
      readonly ok: false;
      readonly en: 'origen' | 'destino';
      readonly violaciones: readonly Violacion[];
    };

/** Separar un servicio deja la ruta sin él y una ruta propia para el servicio. */
export type ResultadoDeSeparar =
  | { readonly ok: true; readonly ruta: Ruta; readonly propia: Ruta }
  | { readonly ok: false; readonly violaciones: readonly Violacion[] };
