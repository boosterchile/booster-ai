import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { telemetryPoints, vehicles } from '../db/schema.js';
import {
  type PuntoSegmentacion,
  type TrayectoTeltonika,
  segmentarTrayectosTeltonika,
} from '../domain/segmentar-trayectos-teltonika.js';

/** Tope de pings por consulta. Si se supera, se quedan los más recientes. */
export const MAX_PUNTOS_TRAYECTO = 20_000;

const ioDataSchema = z.record(z.string(), z.union([z.number(), z.string()]));

export interface ListadoTrayectosTeltonika {
  empresaId: string;
  desde: string;
  hasta: string;
  vehiculosTeltonika: number;
  truncado: boolean;
  cta: 'vincular_teltonika' | null;
  ctaSensor: boolean;
  page: number;
  pageSize: number;
  total: number;
  trayectos: TrayectoTeltonika[];
}

export async function listarTrayectosTeltonika(opts: {
  db: Db;
  logger: Logger;
  empresaId: string;
  desde: Date;
  hasta: Date;
  page: number;
  pageSize: number;
  maxPuntos?: number;
}): Promise<ListadoTrayectosTeltonika> {
  const maxPuntos = opts.maxPuntos ?? MAX_PUNTOS_TRAYECTO;

  // rls-allowlist: solo vehículos de la empresa de la membresía activa.
  const vehiculos = await opts.db
    .select({
      id: vehicles.id,
      plate: vehicles.plate,
      empresaId: vehicles.empresaId,
    })
    .from(vehicles)
    .where(and(eq(vehicles.empresaId, opts.empresaId), isNotNull(vehicles.teltonikaImei)));

  if (vehiculos.length === 0) {
    return vacio(opts, 0, false);
  }

  const ids = vehiculos.map((v) => v.id);
  const porId = new Map(vehiculos.map((v) => [v.id, v]));

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

  const todos = segmentarTrayectosTeltonika(puntos);
  const inicio = (opts.page - 1) * opts.pageSize;
  const pagina = todos.slice(inicio, inicio + opts.pageSize);

  return {
    empresaId: opts.empresaId,
    desde: opts.desde.toISOString(),
    hasta: opts.hasta.toISOString(),
    vehiculosTeltonika: vehiculos.length,
    truncado,
    cta: null,
    ctaSensor: todos.length > 0 && todos.every((t) => t.ctaSensor),
    page: opts.page,
    pageSize: opts.pageSize,
    total: todos.length,
    trayectos: pagina,
  };
}

function vacio(
  opts: { empresaId: string; desde: Date; hasta: Date; page: number; pageSize: number },
  vehiculosTeltonika: number,
  ctaSensor: boolean,
): ListadoTrayectosTeltonika {
  return {
    empresaId: opts.empresaId,
    desde: opts.desde.toISOString(),
    hasta: opts.hasta.toISOString(),
    vehiculosTeltonika,
    truncado: false,
    cta: vehiculosTeltonika === 0 ? 'vincular_teltonika' : null,
    ctaSensor,
    page: opts.page,
    pageSize: opts.pageSize,
    total: 0,
    trayectos: [],
  };
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
