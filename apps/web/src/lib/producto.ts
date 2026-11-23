import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * Los dos productos que Booster vende por separado
 * (`.specs/booster-fleet-interfaz`): `booster` es el marketplace de carga y
 * `fleet` es Booster Fleet, la gestión de flota.
 */
export type Producto = 'booster' | 'fleet';

export const NOMBRE_PRODUCTO: Record<Producto, string> = {
  booster: 'Booster AI',
  fleet: 'Booster Fleet',
};

/**
 * Qué interfaz ve la empresa activa. Es `fleet` solo para la empresa
 * transportista que no es generadora y no recibe ofertas de carga. Un `/me`
 * sin el dato cuenta como que sí las recibe.
 */
export function productoDe(me: MeOnboarded): Producto {
  const empresa = me.active_membership?.empresa;
  if (
    empresa?.is_transportista === true &&
    empresa.is_generador_carga !== true &&
    empresa.recibe_ofertas_carga === false
  ) {
    return 'fleet';
  }
  return 'booster';
}
