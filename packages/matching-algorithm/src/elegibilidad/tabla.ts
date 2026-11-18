/**
 * Compatibilidad entre tipo de carga y carrocería (ADR-090, spec
 * matching-desde-la-carga §3.4).
 *
 * La tabla es la que el PO aprobó el 2026-11-11
 * (.specs/matching-desde-la-carga/plan.md §1.1). Sale de criterio operativo
 * general; no está tomada de una norma. Cambiar un par exige el visto del PO
 * y cambiarlo también en la copia del test.
 *
 * Los valores son espejo de los enums `tipo_carga` y `tipo_carroceria`
 * (`cargoTypeSchema` y `bodyTypeSchema` en shared-schemas). El paquete no
 * importa shared-schemas para seguir sin dependencias; el test comprueba que
 * las listas sean las mismas.
 */

export const TIPOS_DE_CARGA = [
  'carga_seca',
  'perecible',
  'refrigerada',
  'congelada',
  'fragil',
  'peligrosa',
  'liquida',
  'construccion',
  'agricola',
  'ganado',
  'otra',
] as const;
export type TipoDeCarga = (typeof TIPOS_DE_CARGA)[number];

export const CARROCERIAS = [
  'plano',
  'cortina',
  'furgon_cerrado',
  'refrigerado',
  'tolva',
  'cisterna',
  'portacontenedor',
  'cama_baja',
  'jaula',
  'forestal',
] as const;
export type Carroceria = (typeof CARROCERIAS)[number];

const S = true;
const N = false;

/**
 * Los 110 pares. El tipo exige las 11 filas y las 10 columnas: agregar un
 * valor a cualquiera de las dos listas no compila hasta decidir sus pares.
 */
// biome-ignore format: se lee como la tabla del plan, una fila por tipo de carga.
export const COMPATIBILIDAD_CARGA_CARROCERIA: Readonly<
  Record<TipoDeCarga, Readonly<Record<Carroceria, boolean>>>
> = {
  //              plano     cortina     furgon_cerrado     refrigerado     tolva     cisterna     portacontenedor     cama_baja     jaula     forestal
  carga_seca:   { plano: S, cortina: S, furgon_cerrado: S, refrigerado: S, tolva: N, cisterna: N, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  perecible:    { plano: N, cortina: N, furgon_cerrado: S, refrigerado: S, tolva: N, cisterna: N, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  refrigerada:  { plano: N, cortina: N, furgon_cerrado: N, refrigerado: S, tolva: N, cisterna: N, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  congelada:    { plano: N, cortina: N, furgon_cerrado: N, refrigerado: S, tolva: N, cisterna: N, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  fragil:       { plano: N, cortina: S, furgon_cerrado: S, refrigerado: S, tolva: N, cisterna: N, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  peligrosa:    { plano: S, cortina: S, furgon_cerrado: S, refrigerado: N, tolva: N, cisterna: S, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  liquida:      { plano: N, cortina: N, furgon_cerrado: N, refrigerado: N, tolva: N, cisterna: S, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  construccion: { plano: S, cortina: S, furgon_cerrado: S, refrigerado: N, tolva: S, cisterna: N, portacontenedor: N, cama_baja: S, jaula: N, forestal: N },
  agricola:     { plano: S, cortina: S, furgon_cerrado: S, refrigerado: S, tolva: S, cisterna: N, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
  ganado:       { plano: N, cortina: N, furgon_cerrado: N, refrigerado: N, tolva: N, cisterna: N, portacontenedor: N, cama_baja: N, jaula: S, forestal: N },
  otra:         { plano: S, cortina: S, furgon_cerrado: S, refrigerado: N, tolva: N, cisterna: N, portacontenedor: N, cama_baja: N, jaula: N, forestal: N },
};

/**
 * Cargas que acepta un vehículo sin carrocería declarada (spec §3.5 y
 * §11-1): las de uso general. Es el caso de toda la flota al 2026-11-10.
 */
const SIN_CARROCERIA: ReadonlySet<TipoDeCarga> = new Set(['carga_seca', 'otra']);

/** ¿Una unidad con esa carrocería puede llevar ese tipo de carga? */
export function carroceriaCompatible(carga: TipoDeCarga, carroceria: Carroceria | null): boolean {
  if (carroceria === null) {
    return SIN_CARROCERIA.has(carga);
  }
  return COMPATIBILIDAD_CARGA_CARROCERIA[carga][carroceria];
}
