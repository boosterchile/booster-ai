/**
 * Catálogo de regiones de Chile con código romano (el mismo que matching
 * compara contra `viajes.origen_codigo_region`). `13` / `RM` no son válidos.
 */
export const REGIONS_CHILE: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'XV', name: 'XV — Arica y Parinacota' },
  { code: 'I', name: 'I — Tarapacá' },
  { code: 'II', name: 'II — Antofagasta' },
  { code: 'III', name: 'III — Atacama' },
  { code: 'IV', name: 'IV — Coquimbo' },
  { code: 'V', name: 'V — Valparaíso' },
  { code: 'XIII', name: 'XIII — Metropolitana' },
  { code: 'VI', name: "VI — O'Higgins" },
  { code: 'VII', name: 'VII — Maule' },
  { code: 'XVI', name: 'XVI — Ñuble' },
  { code: 'VIII', name: 'VIII — Biobío' },
  { code: 'IX', name: 'IX — La Araucanía' },
  { code: 'XIV', name: 'XIV — Los Ríos' },
  { code: 'X', name: 'X — Los Lagos' },
  { code: 'XI', name: 'XI — Aysén' },
  { code: 'XII', name: 'XII — Magallanes' },
];
