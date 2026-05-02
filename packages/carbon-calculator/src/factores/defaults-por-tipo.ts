import type { ParametrosPorDefecto, TipoCombustible } from '../tipos.js';

/**
 * Defaults conservadores por tipo de vehículo, para el modo
 * `por_defecto` (cuando el carrier no declaró perfil energético).
 *
 * Diseño:
 *   - Combustible asumido = el típico de mercado para ese tipo en Chile.
 *   - Consumo asumido = mediana de la flota chilena (Anuario Estadísticos
 *     INE + datasheets fabricantes 2024).
 *
 * Filosofía: el modo `por_defecto` debe ser CONSERVADOR (sobre-estimar
 * un poco) para que cuando el carrier complete su perfil real las
 * emisiones reportadas BAJEN, no suban. Eso premia la transparencia.
 */
export const DEFAULTS_POR_TIPO: Readonly<
  Record<
    ParametrosPorDefecto['tipoVehiculo'],
    { combustible: TipoCombustible; consumoBasePor100km: number; capacidadKg: number }
  >
> = {
  camioneta: {
    combustible: 'diesel',
    consumoBasePor100km: 11, // L/100km, Hilux/Ranger/D-Max típica
    capacidadKg: 1000,
  },
  furgon_pequeno: {
    combustible: 'diesel',
    consumoBasePor100km: 10,
    capacidadKg: 1500,
  },
  furgon_mediano: {
    combustible: 'diesel',
    consumoBasePor100km: 13,
    capacidadKg: 3500,
  },
  camion_pequeno: {
    combustible: 'diesel',
    consumoBasePor100km: 18,
    capacidadKg: 5000,
  },
  camion_mediano: {
    combustible: 'diesel',
    consumoBasePor100km: 25,
    capacidadKg: 12000,
  },
  camion_pesado: {
    combustible: 'diesel',
    consumoBasePor100km: 35,
    capacidadKg: 28000,
  },
  semi_remolque: {
    combustible: 'diesel',
    consumoBasePor100km: 38,
    capacidadKg: 40000,
  },
  refrigerado: {
    // Suma overhead de la unidad refrigerante (chiller eléctrico/gas/diésel).
    combustible: 'diesel',
    consumoBasePor100km: 30,
    capacidadKg: 15000,
  },
  tanque: {
    combustible: 'diesel',
    consumoBasePor100km: 40,
    capacidadKg: 30000,
  },
};
