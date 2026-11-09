/**
 * Etiquetas en español de los datos de una carga, compartidas por el detalle
 * del generador y el diff de los cambios propuestos (editar-anular-cargas §9).
 */

export type CargoType =
  | 'carga_seca'
  | 'perecible'
  | 'refrigerada'
  | 'congelada'
  | 'fragil'
  | 'peligrosa'
  | 'liquida'
  | 'construccion'
  | 'agricola'
  | 'ganado'
  | 'otra';

export type RegionCode =
  | 'I'
  | 'II'
  | 'III'
  | 'IV'
  | 'V'
  | 'VI'
  | 'VII'
  | 'VIII'
  | 'IX'
  | 'X'
  | 'XI'
  | 'XII'
  | 'XIII'
  | 'XIV'
  | 'XV'
  | 'XVI';

export const CARGO_TYPE_LABELS: Record<CargoType, string> = {
  carga_seca: 'Carga seca',
  perecible: 'Perecible',
  refrigerada: 'Refrigerada',
  congelada: 'Congelada',
  fragil: 'Frágil',
  peligrosa: 'Peligrosa',
  liquida: 'Líquida',
  construccion: 'Construcción',
  agricola: 'Agrícola',
  ganado: 'Ganado',
  otra: 'Otra',
};

export const REGION_LABELS: Record<RegionCode, string> = {
  XV: 'XV — Arica y Parinacota',
  I: 'I — Tarapacá',
  II: 'II — Antofagasta',
  III: 'III — Atacama',
  IV: 'IV — Coquimbo',
  V: 'V — Valparaíso',
  XIII: 'XIII — Metropolitana',
  VI: 'VI — O’Higgins',
  VII: 'VII — Maule',
  XVI: 'XVI — Ñuble',
  VIII: 'VIII — Biobío',
  IX: 'IX — Araucanía',
  XIV: 'XIV — Los Ríos',
  X: 'X — Los Lagos',
  XI: 'XI — Aysén',
  XII: 'XII — Magallanes',
};

export function regionLabel(code: RegionCode | null | undefined): string {
  if (!code) {
    return '—';
  }
  return REGION_LABELS[code] ?? code;
}

/** Línea de tiempo de la carga (editar-anular-cargas §9). */
export const ETIQUETAS_EVENTO: Record<string, string> = {
  intake_iniciado: 'Solicitud iniciada',
  intake_capturado: 'Solicitud capturada',
  matching_iniciado: 'Búsqueda de transportista',
  ofertas_enviadas: 'Ofertas enviadas',
  oferta_aceptada: 'Oferta aceptada',
  oferta_rechazada: 'Oferta rechazada',
  oferta_expirada: 'Oferta vencida',
  asignacion_creada: 'Transportista asignado',
  conductor_asignado: 'Conductor asignado',
  recogida_confirmada: 'Carga recogida',
  entrega_confirmada: 'Entrega confirmada',
  cancelado: 'Cancelada',
  carbono_calculado: 'Huella calculada',
  certificado_emitido: 'Certificado emitido',
  telemetria_primera_recibida: 'Primera posición del vehículo',
  telemetria_perdida: 'Se perdió la señal del vehículo',
  ruta_desviada: 'Desvío de ruta',
  disputa_abierta: 'Disputa abierta',
  incidente_reportado: 'Incidente reportado',
  carga_editada: 'Datos de la carga actualizados',
  cambio_solicitado: 'Cambio propuesto al transportista',
  cambio_respondido: 'Respuesta al cambio propuesto',
};

/** Un tipo que la web todavía no conoce se muestra legible, nunca en crudo. */
export function etiquetaEvento(tipo: string): string {
  const conocida = ETIQUETAS_EVENTO[tipo];
  if (conocida) {
    return conocida;
  }
  const texto = tipo.replace(/_/g, ' ').trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : 'Evento';
}
