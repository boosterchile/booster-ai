import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { empresas, telemetryPoints, vehicles } from '../db/schema.js';
import { type ResumenHubVehiculo, resumirHubVehiculo } from '../domain/resumir-hub-vehiculo.js';
import {
  type ConfigRoboCombustible,
  type PuntoSegmentacion,
  type ResumenCombustibleVehiculo,
  type TrayectoTeltonika,
  resumirCombustibleVehiculos,
  segmentarTrayectosTeltonika,
} from '../domain/segmentar-trayectos-teltonika.js';

/** Tope de pings por consulta. Si se supera, se quedan los más recientes. */
export const MAX_PUNTOS_TRAYECTO = 20_000;

const ioDataSchema = z.record(z.string(), z.union([z.number(), z.string()]));

/**
 * `con_dato`: trayectos con alguna fuente de combustible (84, 83 o 89).
 * `sin_dato`: el resto. Se pagina solo el filtro pedido.
 */
export type FiltroCombustible = 'con_dato' | 'sin_dato';

export interface ListadoTrayectosTeltonika {
  empresaId: string;
  desde: string;
  hasta: string;
  vehiculosTeltonika: number;
  truncado: boolean;
  cta: 'vincular_teltonika' | null;
  ctaSensor: boolean;
  combustible: FiltroCombustible;
  page: number;
  pageSize: number;
  /** Trayectos del filtro pedido. */
  total: number;
  totalConCombustible: number;
  totalSinCombustible: number;
  /** Mejor fuente de combustible de cada vehículo con puntos en la ventana. */
  vehiculos: ResumenCombustibleVehiculo[];
  trayectos: TrayectoTeltonika[];
  /**
   * Presente solo cuando la consulta pide `vehiculoId`. Sale de los mismos
   * trayectos ya segmentados: no hay una segunda lectura ni otra detección.
   */
  resumenVehiculo: ResumenHubVehiculo | null;
}

export async function listarTrayectosTeltonika(opts: {
  db: Db;
  logger: Logger;
  empresaId: string;
  desde: Date;
  hasta: Date;
  page: number;
  pageSize: number;
  combustible?: FiltroCombustible;
  maxPuntos?: number;
  /** Si viene, solo entran los puntos de ese vehículo (tiene que ser de la empresa). */
  vehiculoId?: string | undefined;
  /** Si el trayecto está en la ventana, se agrega a la página para el detalle. */
  detalleId?: string | undefined;
}): Promise<ListadoTrayectosTeltonika> {
  const maxPuntos = opts.maxPuntos ?? MAX_PUNTOS_TRAYECTO;
  const combustible = opts.combustible ?? 'con_dato';

  // rls-allowlist: solo vehículos de la empresa de la membresía activa.
  const flota = await opts.db
    .select({
      id: vehicles.id,
      plate: vehicles.plate,
      empresaId: vehicles.empresaId,
      consumptionLPer100kmBaseline: vehicles.consumptionLPer100kmBaseline,
    })
    .from(vehicles)
    .where(and(eq(vehicles.empresaId, opts.empresaId), isNotNull(vehicles.teltonikaImei)));

  const vehiculos = opts.vehiculoId ? flota.filter((v) => v.id === opts.vehiculoId) : flota;

  if (vehiculos.length === 0) {
    const resumen = opts.vehiculoId ? resumirHubVehiculo([]) : null;
    const conTeltonika = opts.vehiculoId ? flota.length : 0;
    return vacio({ ...opts, combustible }, conTeltonika, false, resumen);
  }

  const ids = vehiculos.map((v) => v.id);
  const porId = new Map(vehiculos.map((v) => [v.id, v]));
  const config = await leerUmbrales(opts.db, opts.empresaId);

  // rls-allowlist: puntos de esos vehículos, ventana acotada, índice vehiculo+ts.
  const filas = await opts.db
    .select({
      vehicleId: telemetryPoints.vehicleId,
      timestampDevice: telemetryPoints.timestampDevice,
      latitude: telemetryPoints.latitude,
      longitude: telemetryPoints.longitude,
      speedKmh: telemetryPoints.speedKmh,
      ioData: telemetryPoints.ioData,
    })
    .from(telemetryPoints)
    .where(
      and(
        inArray(telemetryPoints.vehicleId, ids),
        gte(telemetryPoints.timestampDevice, opts.desde),
        lte(telemetryPoints.timestampDevice, opts.hasta),
      ),
    )
    .orderBy(desc(telemetryPoints.timestampDevice))
    .limit(maxPuntos + 1);

  const truncado = filas.length > maxPuntos;
  const usados = truncado ? filas.slice(0, maxPuntos) : filas;

  let ioInvalidos = 0;
  const puntos: PuntoSegmentacion[] = [];
  for (const fila of usados) {
    const vehiculo = porId.get(fila.vehicleId);
    if (!vehiculo) {
      continue;
    }
    const io = ioNumerico(fila.ioData);
    if (io == null) {
      ioInvalidos += 1;
    }
    puntos.push({
      vehiculoId: fila.vehicleId,
      empresaId: vehiculo.empresaId,
      patente: vehiculo.plate,
      capacidadEstanqueL: null,
      consumoLPor100kmBase: consumoBaseDe(vehiculo.consumptionLPer100kmBaseline),
      // Hora del AVL, no `timestamp_recibido_en`: un buffer sin señal celular
      // llega tarde y la ventana de robo (5 min) tiene que usar este reloj.
      tMs: fila.timestampDevice.getTime(),
      lat: aNumero(fila.latitude),
      lng: aNumero(fila.longitude),
      speedKmh: fila.speedKmh,
      io: io ?? {},
    });
  }

  if (ioInvalidos > 0) {
    opts.logger.warn(
      { empresaId: opts.empresaId, ioInvalidos },
      'trayectos-teltonika: io_data ilegible, se omite el IO de esos puntos',
    );
  }

  const todos = segmentarTrayectosTeltonika(puntos, config);
  const conDato = todos.filter((t) => t.fuenteCombustible != null);
  const sinDato = todos.filter((t) => t.fuenteCombustible == null);
  const filtrados = combustible === 'con_dato' ? conDato : sinDato;
  const inicio = (opts.page - 1) * opts.pageSize;
  let pagina = filtrados.slice(inicio, inicio + opts.pageSize);
  if (opts.detalleId) {
    const asegurado = todos.find((t) => t.id === opts.detalleId);
    if (asegurado && !pagina.some((t) => t.id === asegurado.id)) {
      pagina = [asegurado, ...pagina];
    }
  }

  return {
    empresaId: opts.empresaId,
    desde: opts.desde.toISOString(),
    hasta: opts.hasta.toISOString(),
    vehiculosTeltonika: vehiculos.length,
    truncado,
    cta: null,
    ctaSensor: todos.length > 0 && todos.every((t) => t.ctaSensor),
    combustible,
    page: opts.page,
    pageSize: opts.pageSize,
    total: filtrados.length,
    totalConCombustible: conDato.length,
    totalSinCombustible: sinDato.length,
    vehiculos: resumirCombustibleVehiculos(puntos),
    trayectos: pagina,
    resumenVehiculo: opts.vehiculoId ? resumirHubVehiculo(todos) : null,
  };
}

async function leerUmbrales(db: Db, empresaId: string): Promise<ConfigRoboCombustible> {
  // rls-allowlist: umbrales de la empresa de la membresía activa.
  const rows = await db
    .select({
      umbralRoboGolpeL: empresas.umbralRoboGolpeL,
      umbralRoboHormigaL: empresas.umbralRoboHormigaL,
    })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  const row = rows[0];
  return {
    uGolpeL: row?.umbralRoboGolpeL ?? null,
    uHormigaL: row?.umbralRoboHormigaL ?? null,
  };
}

function vacio(
  opts: {
    empresaId: string;
    desde: Date;
    hasta: Date;
    page: number;
    pageSize: number;
    combustible: FiltroCombustible;
  },
  vehiculosTeltonika: number,
  ctaSensor: boolean,
  resumenVehiculo: ResumenHubVehiculo | null,
): ListadoTrayectosTeltonika {
  return {
    empresaId: opts.empresaId,
    desde: opts.desde.toISOString(),
    hasta: opts.hasta.toISOString(),
    vehiculosTeltonika,
    truncado: false,
    cta: vehiculosTeltonika === 0 ? 'vincular_teltonika' : null,
    ctaSensor,
    combustible: opts.combustible,
    page: opts.page,
    pageSize: opts.pageSize,
    total: 0,
    totalConCombustible: 0,
    totalSinCombustible: 0,
    vehiculos: [],
    trayectos: [],
    resumenVehiculo,
  };
}

/** `numeric` de Postgres llega como string. Sin base, o ≤ 0, no hay tope. */
function consumoBaseDe(valor: string | number | null | undefined): number | null {
  if (valor == null || valor === '') {
    return null;
  }
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function ioNumerico(ioData: unknown): Record<string, number> | null {
  const parsed = ioDataSchema.safeParse(ioData);
  if (!parsed.success) {
    return null;
  }
  const io: Record<string, number> = {};
  for (const [clave, valor] of Object.entries(parsed.data)) {
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      io[clave] = valor;
    }
  }
  return io;
}

function aNumero(valor: string | number | null): number | null {
  if (valor == null) {
    return null;
  }
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}
