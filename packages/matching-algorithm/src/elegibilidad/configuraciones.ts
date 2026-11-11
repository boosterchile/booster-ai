import { type Carroceria, type TipoDeCarga, carroceriaCompatible } from './tabla.js';

/**
 * Elegibilidad por configuración (ADR-090, spec matching-desde-la-carga §3.2
 * y §3.3; reglas de configuración aprobadas en plan.md §2).
 *
 * Una configuración es una unidad motriz sola, o una motriz con una unidad de
 * arrastre de la misma empresa. Estas funciones no leen la base: quien llama
 * entrega la flota **activa** de una empresa.
 */

/** Espejo de `tipo_unidad` (`unitTypeSchema` en shared-schemas). */
export const TIPOS_DE_UNIDAD = [
  'tracto_camion',
  'camion_rigido',
  'camioneta',
  'furgon',
  'semirremolque',
  'remolque',
] as const;
export type TipoDeUnidad = (typeof TIPOS_DE_UNIDAD)[number];

export interface UnidadDeFlota {
  readonly id: string;
  readonly unitCategory: 'motriz' | 'arrastre';
  /** Nulo en filas anteriores a las tipologías (ADR-073): carga sola, sin arrastre. */
  readonly unitType: TipoDeUnidad | null;
  readonly bodyType: Carroceria | null;
  readonly capacityKg: number;
  readonly capacityM3: number | null;
}

export interface RequisitosDeCarga {
  readonly cargoType: TipoDeCarga;
  /** Sin peso declarado, la carga no descarta por peso (como el matching vigente). */
  readonly weightKg: number | null;
  readonly volumeM3: number | null;
}

export interface ConfiguracionElegible {
  readonly motrizId: string;
  readonly arrastreId: string | null;
  readonly capacidadUtilKg: number;
  /** Nulo cuando alguna unidad que aporta capacidad no declara volumen. */
  readonly capacidadUtilM3: number | null;
  /**
   * La carga y la configuración declaran volumen y el de la configuración no
   * alcanza. Es un aviso: no la descarta (spec §11-5).
   */
  readonly volumenInsuficiente: boolean;
}

/**
 * Qué arrastre lleva cada motriz. Misma regla que `esConfiguracionCompatible`
 * de shared-schemas (ADR-073); el test las compara par por par.
 */
export function componeConArrastre(motriz: TipoDeUnidad | null, arrastre: TipoDeUnidad | null) {
  if (motriz === 'tracto_camion') {
    return arrastre === 'semirremolque';
  }
  if (motriz === 'camion_rigido') {
    return arrastre === 'remolque';
  }
  return false;
}

/** Capacidad de la configuración para una carga: la de las unidades que le sirven. */
function capacidadUtil(
  carga: RequisitosDeCarga,
  unidades: readonly UnidadDeFlota[],
): Pick<ConfiguracionElegible, 'capacidadUtilKg' | 'capacidadUtilM3'> | null {
  const sirven = unidades.filter((u) => carroceriaCompatible(carga.cargoType, u.bodyType));
  if (sirven.length === 0) {
    return null;
  }
  const volumenes = sirven.map((u) => u.capacityM3);
  return {
    capacidadUtilKg: sirven.reduce((suma, u) => suma + u.capacityKg, 0),
    capacidadUtilM3: volumenes.some((v) => v === null)
      ? null
      : volumenes.reduce<number>((suma, v) => suma + (v ?? 0), 0),
  };
}

/**
 * Las unidades que cargan en una configuración:
 * - motriz sola: la motriz (un tracto solo no carga nada);
 * - tracto con semirremolque: el semirremolque;
 * - rígido con remolque: las dos.
 */
function unidadesQueCargan(
  motriz: UnidadDeFlota,
  arrastre: UnidadDeFlota | null,
): readonly UnidadDeFlota[] {
  if (motriz.unitType === 'tracto_camion') {
    return arrastre ? [arrastre] : [];
  }
  return arrastre ? [motriz, arrastre] : [motriz];
}

/**
 * El volumen declarado no descarta: en la flota real ese dato es poco
 * confiable (decisión del PO del 2026-11-11, spec §11-5). Se compara solo
 * cuando la carga y la configuración lo declaran, y el resultado es un aviso.
 */
function volumenNoAlcanza(carga: RequisitosDeCarga, capacidadUtilM3: number | null): boolean {
  return carga.volumeM3 !== null && capacidadUtilM3 !== null && capacidadUtilM3 < carga.volumeM3;
}

/**
 * Las configuraciones de la flota que pueden llevar la carga: capacidad útil
 * suficiente para el peso y carrocería compatible. Primero las que no tienen
 * aviso de volumen y, dentro de cada grupo, de menor a mayor capacidad útil;
 * la primera es la sugerencia para la oferta (spec §3.6).
 */
export function configuracionesElegibles(
  carga: RequisitosDeCarga,
  flota: readonly UnidadDeFlota[],
): ConfiguracionElegible[] {
  const motrices = flota.filter((u) => u.unitCategory === 'motriz');
  const arrastres = flota.filter((u) => u.unitCategory === 'arrastre');

  const elegibles: ConfiguracionElegible[] = [];
  for (const motriz of motrices) {
    const acompanantes: (UnidadDeFlota | null)[] = [
      null,
      ...arrastres.filter((a) => componeConArrastre(motriz.unitType, a.unitType)),
    ];
    for (const arrastre of acompanantes) {
      const capacidad = capacidadUtil(carga, unidadesQueCargan(motriz, arrastre));
      if (!capacidad) {
        continue;
      }
      if (capacidad.capacidadUtilKg < (carga.weightKg ?? 0)) {
        continue;
      }
      elegibles.push({
        motrizId: motriz.id,
        arrastreId: arrastre?.id ?? null,
        ...capacidad,
        volumenInsuficiente: volumenNoAlcanza(carga, capacidad.capacidadUtilM3),
      });
    }
  }

  return elegibles.sort(
    (a, b) =>
      Number(a.volumenInsuficiente) - Number(b.volumenInsuficiente) ||
      a.capacidadUtilKg - b.capacidadUtilKg ||
      a.motrizId.localeCompare(b.motrizId) ||
      (a.arrastreId ?? '').localeCompare(b.arrastreId ?? ''),
  );
}

/** Una empresa es candidata si tiene al menos una configuración elegible. */
export function empresaEsCandidata(
  carga: RequisitosDeCarga,
  flota: readonly UnidadDeFlota[],
): boolean {
  return configuracionesElegibles(carga, flota).length > 0;
}
