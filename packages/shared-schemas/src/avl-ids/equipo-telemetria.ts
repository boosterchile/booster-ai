import { z } from 'zod';
import {
  AVL_ID_CAN,
  CAN_FUEL_LEVEL_L_SCALE,
  canEngineRpmRawSchema,
  canFuelLevelLRawSchema,
  canVehicleSpeedRawSchema,
} from './can-lvcan.js';
import {
  AVL_ID_DALLAS,
  DALLAS_TEMPERATURE_MAX_C,
  DALLAS_TEMPERATURE_MIN_C,
} from './dallas-temperature.js';
import { AVL_ID_EVENT } from './high-panic.js';

/**
 * Techo de lo que Booster sabe interpretar de un equipo de telemetría.
 * El FMC150 es el modelo en uso. Otro modelo entra por su detalle:
 * el resultado nunca supera los catálogos AVL ya versionados.
 */

const detalleEquipoSchema = z.object({
  fabricante: z.string().trim().min(1),
  modelo: z.string().trim().min(1),
  protocolo: z.enum(['codec8', 'codec8_extended', 'gps_movil', 'desconocido']).optional(),
  sensoresDallas: z.number().int().min(0).optional(),
  tieneCan: z.boolean().optional(),
  tieneGnss: z.boolean().optional(),
});

export type DetalleEquipo = z.infer<typeof detalleEquipoSchema>;

export interface RangoDallas {
  sensores: number;
  minC: number;
  maxC: number;
}

export interface CapacidadCan {
  ids: number[];
  velocidadMaxKmh: number;
  combustibleMaxLitros: number;
  rpmMax: number;
}

export interface CapacidadesEquipo {
  fabricante: string;
  modelo: string;
  protocolo: 'codec8' | 'codec8_extended' | 'gps_movil' | 'desconocido';
  gnss: boolean;
  codec8: boolean;
  codec8Extended: boolean;
  dallas: RangoDallas | null;
  can: CapacidadCan | null;
  eventos: string[];
  trazaImpacto: boolean;
  /** ADR-077: solo CAN de un Teltonika puede llegar a primario verificable. */
  puedeCertificacionPrimaria: boolean;
}

const DALLAS_MAX_SENSORES = Object.keys(AVL_ID_DALLAS).length;

function techoEntero(schema: z.ZodNumber): number {
  const checks = schema._def.checks;
  const techo = checks.find((check) => check.kind === 'max');
  if (techo === undefined || techo.kind !== 'max') {
    throw new Error('el schema numérico no declara techo');
  }
  return techo.value;
}

function capacidadCan(): CapacidadCan {
  const combustibleRaw = techoEntero(canFuelLevelLRawSchema);
  return {
    ids: Object.values(AVL_ID_CAN),
    velocidadMaxKmh: techoEntero(canVehicleSpeedRawSchema),
    combustibleMaxLitros: combustibleRaw * CAN_FUEL_LEVEL_L_SCALE,
    rpmMax: techoEntero(canEngineRpmRawSchema),
  };
}

function dallasAlTope(sensores: number): RangoDallas {
  return {
    sensores: Math.min(sensores, DALLAS_MAX_SENSORES),
    minC: DALLAS_TEMPERATURE_MIN_C,
    maxC: DALLAS_TEMPERATURE_MAX_C,
  };
}

function capacidadesFmc150(): CapacidadesEquipo {
  return {
    fabricante: 'Teltonika',
    modelo: 'FMC150',
    protocolo: 'codec8_extended',
    gnss: true,
    codec8: true,
    codec8Extended: true,
    dallas: dallasAlTope(DALLAS_MAX_SENSORES),
    can: capacidadCan(),
    eventos: Object.keys(AVL_ID_EVENT),
    trazaImpacto: true,
    puedeCertificacionPrimaria: true,
  };
}

function capacidadesGpsMovil(): CapacidadesEquipo {
  return {
    fabricante: 'Booster',
    modelo: 'gps_movil',
    protocolo: 'gps_movil',
    gnss: true,
    codec8: false,
    codec8Extended: false,
    dallas: null,
    can: null,
    eventos: [],
    trazaImpacto: false,
    puedeCertificacionPrimaria: false,
  };
}

function claveModelo(modelo: string): string {
  return modelo.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function capacidadesDesdeDetalle(detalle: DetalleEquipo): CapacidadesEquipo {
  const protocolo = detalle.protocolo ?? 'desconocido';
  const codec8 = protocolo === 'codec8' || protocolo === 'codec8_extended';
  const codec8Extended = protocolo === 'codec8_extended';
  const gnss = detalle.tieneGnss === true || codec8 || protocolo === 'gps_movil';
  const sensores = detalle.sensoresDallas ?? 0;
  const admiteCan = detalle.tieneCan === true && (codec8 || protocolo === 'desconocido');

  return {
    fabricante: detalle.fabricante,
    modelo: detalle.modelo.trim(),
    protocolo,
    gnss,
    codec8,
    codec8Extended,
    dallas: sensores > 0 ? dallasAlTope(sensores) : null,
    can: admiteCan ? capacidadCan() : null,
    eventos: [],
    trazaImpacto: false,
    puedeCertificacionPrimaria: admiteCan && codec8,
  };
}

/** Lee un detalle ya validado por Zod y devuelve el techo interpretable. */
export function extraerCapacidadesMaximas(input: unknown): CapacidadesEquipo {
  const detalle = detalleEquipoSchema.parse(input);
  const clave = claveModelo(detalle.modelo);
  if (clave === 'fmc150' || clave === 'teltonikafmc150') {
    return capacidadesFmc150();
  }
  if (clave === 'gpsmovil' || clave === 'movil') {
    return capacidadesGpsMovil();
  }
  return capacidadesDesdeDetalle(detalle);
}
