/**
 * Observatorio urbano (ADR-012 Capa 2) — funciones puras.
 *
 * - `proyectarViaje`: un viaje entregado de Cloud SQL a la fila de
 *   `observatory.viajes`. La franja, el tipo de día y el mes se calculan
 *   aquí, en hora de Chile, para que las vistas materializadas solo agrupen.
 * - `filtrarK`: privacidad (ADR-012 §Privacidad). Un bucket se publica solo
 *   con al menos 10 vehículos distintos; las vistas ya lo aplican y el API lo
 *   vuelve a aplicar como defensa en profundidad.
 */

export const K_MIN_VEHICULOS = 10;

const ZONA_CHILE = 'America/Santiago';

export type Franja = '06-09' | '09-12' | '12-15' | '15-18' | '18-21' | '21-06';
export type ClaseVehiculo = 'liviano' | 'pesado';

const LIVIANOS = new Set(['camioneta', 'furgon_pequeno', 'furgon_mediano']);

export function claseVehiculo(tipoVehiculo: string): ClaseVehiculo {
  return LIVIANOS.has(tipoVehiculo) ? 'liviano' : 'pesado';
}

/** Hora, día de la semana y fecha calendario en Chile. */
function partesChile(fecha: Date): { hora: number; diaSemana: string; anio: string; mes: string } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_CHILE,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(fecha);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    hora: Number(valor('hour')),
    diaSemana: valor('weekday'),
    anio: valor('year'),
    mes: valor('month'),
  };
}

export function franjaHoraria(fecha: Date): Franja {
  const { hora } = partesChile(fecha);
  if (hora >= 6 && hora < 9) {
    return '06-09';
  }
  if (hora >= 9 && hora < 12) {
    return '09-12';
  }
  if (hora >= 12 && hora < 15) {
    return '12-15';
  }
  if (hora >= 15 && hora < 18) {
    return '15-18';
  }
  if (hora >= 18 && hora < 21) {
    return '18-21';
  }
  return '21-06';
}

export interface ViajeEntregado {
  viajeId: string;
  vehiculoId: string;
  origenRegion: string | null;
  origenComuna: string | null;
  destinoRegion: string | null;
  destinoComuna: string | null;
  recogidoEn: Date | null;
  entregadoEn: Date;
  tipoVehiculo: string;
  /** numeric de Postgres llega como string. */
  distanciaKm: string | null;
  kgco2eReales: string | null;
  kgco2eEstimadas: string | null;
  kgco2eEvitado: string | null;
}

export interface FilaObservatorio {
  viaje_id: string;
  vehiculo_id: string;
  origen_region: string;
  origen_comuna: string;
  destino_region: string;
  destino_comuna: string;
  mes: string;
  tipo_dia: 'laboral' | 'fin_semana';
  franja: Franja;
  clase_vehiculo: ClaseVehiculo;
  recogido_en: string | null;
  entregado_en: string;
  distancia_km: number | null;
  kgco2e: number;
  kgco2e_evitado: number;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

export function proyectarViaje(v: ViajeEntregado): FilaObservatorio {
  // La franja describe cuándo se mueve la carga: la recogida; sin ella, la entrega.
  const referencia = v.recogidoEn ?? v.entregadoEn;
  const { diaSemana, anio, mes } = partesChile(referencia);
  return {
    viaje_id: v.viajeId,
    vehiculo_id: v.vehiculoId,
    origen_region: v.origenRegion ?? 'sin_region',
    origen_comuna: v.origenComuna ?? 'sin_comuna',
    destino_region: v.destinoRegion ?? 'sin_region',
    destino_comuna: v.destinoComuna ?? 'sin_comuna',
    mes: `${anio}-${mes}`,
    tipo_dia: diaSemana === 'Sat' || diaSemana === 'Sun' ? 'fin_semana' : 'laboral',
    franja: franjaHoraria(referencia),
    clase_vehiculo: claseVehiculo(v.tipoVehiculo),
    recogido_en: v.recogidoEn?.toISOString() ?? null,
    entregado_en: v.entregadoEn.toISOString(),
    distancia_km: num(v.distanciaKm),
    kgco2e: num(v.kgco2eReales) ?? num(v.kgco2eEstimadas) ?? 0,
    kgco2e_evitado: num(v.kgco2eEvitado) ?? 0,
  };
}

/**
 * Deja solo buckets con al menos `K_MIN_VEHICULOS` vehículos y quita
 * cualquier `vehiculo_id`/`viaje_id` que se haya colado. Falla cerrado: un
 * `vehiculos` ausente o no numérico descarta la fila.
 */
export function filtrarK<T extends Record<string, unknown>>(filas: T[]): T[] {
  return filas
    .filter((f) => typeof f.vehiculos === 'number' && f.vehiculos >= K_MIN_VEHICULOS)
    .map((f) => {
      const { vehiculo_id: _v, viaje_id: _t, ...resto } = f;
      return resto as T;
    });
}
