/**
 * Tipos de la ruta (ADR-088, spec ruta-parada-servicio §3 y §4).
 *
 * El paquete no conoce la base: recibe la ruta ya cargada y devuelve la ruta
 * resultante o los motivos del rechazo.
 */
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
  readonly pesoKg: number | null;
  readonly volumenM3: number | null;
  readonly cancelado: boolean;
}

/** Capacidad útil de la configuración declarada (motriz y arrastre, ADR-073). */
export interface Configuracion {
  readonly capacidadKg: number;
  readonly capacidadM3: number | null;
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
  'capacidad_volumen_excedida',
  'en_curso_sin_vehiculo',
  'en_curso_sin_conductor',
  'servicio_de_otra_empresa',
  'servicio_sin_peso_en_ruta_consolidada',
  'ruta_no_editable',
  'servicio_ya_en_la_ruta',
  'servicio_no_esta_en_la_ruta',
  'recogida_antes_de_parada_resuelta',
  'servicio_ya_recogido',
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
}

export type Resultado =
  | { readonly ok: true; readonly ruta: Ruta }
  | { readonly ok: false; readonly violaciones: readonly Violacion[] };
