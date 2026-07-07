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
  // ---------------------------------------------------------------------
  // W4a (ADR-073) — tipos nuevos de `tipo_unidad` (migración 0048). Solo
  // agregamos acá los que tienen un perfil energético propio con sentido
  // en este modo "un solo tipo sin más contexto" (`por_defecto` sin
  // configuración conocida). `camion_rigido`/`camioneta`/`furgon` de
  // `tipo_unidad` NO se agregan: ya están cubiertos por sus equivalentes
  // legacy de arriba (camion_pequeno/mediano/pesado, camioneta,
  // furgon_pequeno/mediano) — agregar duplicados sería redundante y una
  // fuente de drift entre dos entries que deberían responder lo mismo.
  //
  // `semirremolque`/`remolque` (arrastre, D4.5) NO TIENEN motor propio —
  // `fuel_type`/`consumo` siempre son null a nivel de vehículo real. Los
  // valores acá NO representan "el consumo del arrastre solo" (no existe:
  // un arrastre no consume combustible), sino un placeholder conservador
  // para el caso edge de este modo legacy recibiendo un tipoVehiculo de
  // arrastre sin más contexto — en la práctica, W4c siempre construye la
  // configuración completa (motriz+arrastre) y usa `categoriaPorConfiguracion`
  // + modo `modelado`/`exacto_canbus` con el perfil de la unidad MOTRIZ, no
  // este modo `por_defecto` por tipo de arrastre suelto.
  tracto_camion: {
    combustible: 'diesel',
    // Tracto solo (sin semirremolque enganchado): consumo real de un
    // chasís pesado circulando vacío/sin carga propia. Menor que un
    // camion_pesado con caja porque no arrastra masa adicional en este
    // caso hipotético — valor conservador documentado, no medición real.
    consumoBasePor100km: 33,
    // D1.2 — un tracto no carga solo.
    capacidadKg: 0,
  },
  semirremolque: {
    combustible: 'diesel',
    // Igual al legacy `semi_remolque` (línea arriba): representa el
    // ensamble completo tracto+semi cuando este modo legacy solo conoce
    // "semirremolque" sin más contexto (no el arrastre aislado, que no
    // consume combustible por sí mismo).
    consumoBasePor100km: 38,
    capacidadKg: 40000,
  },
  remolque: {
    combustible: 'diesel',
    // Ensamble rígido+remolque: GVW típicamente menor que tracto+semi
    // (remolque de menor porte que un semirremolque estándar chileno).
    consumoBasePor100km: 32,
    capacidadKg: 20000,
  },
};
