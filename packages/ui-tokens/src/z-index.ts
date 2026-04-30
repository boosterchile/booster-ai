/**
 * Z-index escala canónica.
 *
 * Capas explícitas para evitar la guerra de `z-index: 9999` en producción.
 * Si necesitás algo entre dos capas, agregá una intermedia acá; nunca
 * inline en los componentes.
 */
export const zIndex = {
  base: 0,
  raised: 10, // sticky table headers, hovered cards
  dropdown: 1000, // selects abiertos, autocompletes
  sticky: 1100, // navbar fixed
  banner: 1200, // banners de status global
  overlay: 1300, // backdrops oscurantes
  modal: 1400, // modal dialogs
  popover: 1500, // popovers, tooltips arriba de modal
  toast: 1600, // notifications transient
  max: 9999, // emergency only — preferir agregar capa intermedia
} as const;

export type ZIndex = typeof zIndex;
