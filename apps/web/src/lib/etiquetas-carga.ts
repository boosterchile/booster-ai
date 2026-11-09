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
