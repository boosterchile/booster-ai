import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { empresas, telemetryPoints, vehicles } from '../db/schema.js';
import { type ResumenHubVehiculo, resumirHubVehiculo } from '../domain/resumir-hub-vehiculo.js';
import {
  AVL_LEIDOS_POR_SEGMENTADOR,
  type ConfigRoboCombustible,
  type FuenteCombustibleCan,
  type PuntoSegmentacion,
  type ResumenCombustibleVehiculo,
  type TrayectoTeltonika,
  resumirCombustibleVehiculos,
  segmentarTrayectosTeltonika,
} from '../domain/segmentar-trayectos-teltonika.js';

/** Tope de pings del listado de la flota. Si se supera, se quedan los más recientes. */
export const MAX_PUNTOS_TRAYECTO = 20_000;

/**
 * Presupuesto de puntos por consulta del panel de Booster Fleet y de la
 * lectura de un solo vehículo. Un camión genera unos 25.000 puntos por
 * semana: cubre 16 camiones con sus 7 días completos
 * (`.specs/booster-fleet-ventana-completa`).
 */
export const PRESUPUESTO_PUNTOS_PANEL = 400_000;

/**
 * `global`: los puntos más recientes de toda la flota, hasta el tope.
 * `por_vehiculo`: cada vehículo trae su ventana; si no cabe, el presupuesto
 * se reparte parejo y cada uno conserva sus puntos más recientes.
 */
export type RepartoPuntos = 'global' | 'por_vehiculo';

/**
 * Cuántos puntos lee cada vehículo. Si todo cabe, todos. Si no, partes
 * iguales; lo que un vehículo con pocos puntos no usa pasa a los demás.
 */
export function repartirPresupuesto(
  conteos: ReadonlyMap<string, number>,
  presupuesto: number,
): Map<string, number> {
  const cuotas = new Map<string, number>();
  let total = 0;
  for (const puntos of conteos.values()) {
    total += puntos;
  }
  if (total <= presupuesto) {
    for (const [id, puntos] of conteos) {
      cuotas.set(id, puntos);
    }
    return cuotas;
  }
  const orden = [...conteos.entries()].sort((a, b) => a[1] - b[1]);
  let resto = Math.max(0, presupuesto);
  orden.forEach(([id, puntos], i) => {
    const cuota = Math.min(puntos, Math.floor(resto / (orden.length - i)));
    cuotas.set(id, cuota);
    resto -= cuota;
  });
  return cuotas;
}

/**
 * `io_data` con solo las claves que lee el segmentador. El resto del
 * registro se queda en la base. Una clave ausente no viaja como null.
 */
const ioProyectado = sql<unknown>`jsonb_strip_nulls(jsonb_build_object(${sql.join(
  AVL_LEIDOS_POR_SEGMENTADOR.map(
    (clave) => sql`${sql.raw(`'${clave}'`)}, ${telemetryPoints.ioData} -> ${sql.raw(`'${clave}'`)}`,
  ),
  sql`, `,
)}))`;

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
  /** Algún trayecto de la ventana tiene % del 84 y le falta la capacidad. */
  ctaCapacidadEstanque: boolean;
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

export interface LecturaTrayectosFlota {
  empresaId: string;
  desde: string;
  hasta: string;
  vehiculosTeltonika: number;
  truncado: boolean;
  /** Con recorte, el instante del punto más antiguo que se leyó. Null si no hubo recorte. */
  coberturaDesde: string | null;
  puntosLeidos: number;
  /** Puntos que había en la ventana. Solo se cuenta en el reparto por vehículo. */
  puntosEnVentana: number | null;
  cta: 'vincular_teltonika' | null;
  ctaSensor: boolean;
  ctaCapacidadEstanque: boolean;
  vehiculos: ResumenCombustibleVehiculo[];
  /** Todos los segmentos de la ventana, con y sin combustible. Sin paginar. */
  trayectos: TrayectoTeltonika[];
  resumenVehiculo: ResumenHubVehiculo | null;
}

/**
 * Lee y segmenta los trayectos Teltonika de la empresa en la ventana.
 * Booster Fleet arma el control de combustible con esto, sin paginar:
 * el dueño tiene que ver el robo y el sensor aunque el trayecto no traiga litros.
 */
export async function leerTrayectosDeLaFlota(opts: {
  db: Db;
  logger: Logger;
  empresaId: string;
  desde: Date;
  hasta: Date;
  maxPuntos?: number;
  vehiculoId?: string | undefined;
  reparto?: RepartoPuntos;
}): Promise<LecturaTrayectosFlota> {
  const reparto = opts.reparto ?? 'global';
  // Un solo vehículo no compite con nadie: lee su ventana hasta el presupuesto.
  const maxPuntos =
    opts.maxPuntos ??
    (reparto === 'por_vehiculo' || opts.vehiculoId
      ? PRESUPUESTO_PUNTOS_PANEL
      : MAX_PUNTOS_TRAYECTO);

  // rls-allowlist: solo vehículos de la empresa de la membresía activa.
  const flota = await opts.db
    .select({
      id: vehicles.id,
      plate: vehicles.plate,
      empresaId: vehicles.empresaId,
      capacidadEstanqueL: vehicles.capacidadEstanqueL,
      fuenteCombustibleCan: vehicles.fuenteCombustibleCan,
    })
    .from(vehicles)
    .where(and(eq(vehicles.empresaId, opts.empresaId), isNotNull(vehicles.teltonikaImei)));

  const vehiculos = opts.vehiculoId ? flota.filter((v) => v.id === opts.vehiculoId) : flota;

  if (vehiculos.length === 0) {
    const resumen = opts.vehiculoId ? resumirHubVehiculo([]) : null;
    const conTeltonika = opts.vehiculoId ? flota.length : 0;
    return {
      empresaId: opts.empresaId,
      desde: opts.desde.toISOString(),
      hasta: opts.hasta.toISOString(),
      vehiculosTeltonika: conTeltonika,
      truncado: false,
      coberturaDesde: null,
      puntosLeidos: 0,
      puntosEnVentana: null,
      cta: conTeltonika === 0 ? 'vincular_teltonika' : null,
      ctaSensor: false,
      ctaCapacidadEstanque: false,
      vehiculos: [],
      trayectos: [],
      resumenVehiculo: resumen,
    };
  }

  const ids = vehiculos.map((v) => v.id);
  const porId = new Map(vehiculos.map((v) => [v.id, v]));
  const config = await leerUmbrales(opts.db, opts.empresaId);

  const seleccion = {
    vehicleId: telemetryPoints.vehicleId,
    timestampDevice: telemetryPoints.timestampDevice,
    latitude: telemetryPoints.latitude,
    longitude: telemetryPoints.longitude,
    speedKmh: telemetryPoints.speedKmh,
    ioData: ioProyectado,
  };
  const enVentana = and(
    gte(telemetryPoints.timestampDevice, opts.desde),
    lte(telemetryPoints.timestampDevice, opts.hasta),
  );

  let usados: Array<{
    vehicleId: string;
    timestampDevice: Date;
    latitude: string | null;
    longitude: string | null;
    speedKmh: number | null;
    ioData: unknown;
  }> = [];
  let truncado = false;
  let puntosEnVentana: number | null = null;

  if (reparto === 'por_vehiculo') {
    // rls-allowlist: conteo por vehículo de la empresa, ventana acotada.
    const conteos = await opts.db
      .select({
        vehicleId: telemetryPoints.vehicleId,
        puntos: sql<number>`count(*)::int`,
      })
      .from(telemetryPoints)
      .where(and(inArray(telemetryPoints.vehicleId, ids), enVentana))
      .groupBy(telemetryPoints.vehicleId);
    const porVehiculo = new Map(conteos.map((fila) => [fila.vehicleId, Number(fila.puntos)]));
    puntosEnVentana = 0;
    for (const puntosDelVehiculo of porVehiculo.values()) {
      puntosEnVentana += puntosDelVehiculo;
    }
    const cuotas = repartirPresupuesto(porVehiculo, maxPuntos);
    // En el orden de la flota, para que la lectura sea siempre la misma.
    for (const vehicleId of ids) {
      const cuota = cuotas.get(vehicleId) ?? 0;
      if (cuota < (porVehiculo.get(vehicleId) ?? 0)) {
        truncado = true;
      }
      if (cuota <= 0) {
        continue;
      }
      // rls-allowlist: puntos de un vehículo de la empresa, ventana acotada, índice vehiculo+ts.
      const delVehiculo = await opts.db
        .select(seleccion)
        .from(telemetryPoints)
        .where(and(eq(telemetryPoints.vehicleId, vehicleId), enVentana))
        .orderBy(desc(telemetryPoints.timestampDevice))
        .limit(cuota);
      for (const fila of delVehiculo) {
        usados.push(fila);
      }
    }
    if (truncado) {
      opts.logger.warn(
        { empresaId: opts.empresaId, puntosEnVentana, presupuesto: maxPuntos },
        'trayectos-teltonika: la ventana supera el presupuesto de puntos, se recorta por vehículo',
      );
    }
  } else {
    // rls-allowlist: puntos de esos vehículos, ventana acotada, índice vehiculo+ts.
    const filas = await opts.db
      .select(seleccion)
      .from(telemetryPoints)
      .where(and(inArray(telemetryPoints.vehicleId, ids), enVentana))
      .orderBy(desc(telemetryPoints.timestampDevice))
      .limit(maxPuntos + 1);
    truncado = filas.length > maxPuntos;
    usados = truncado ? filas.slice(0, maxPuntos) : filas;
  }

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
      capacidadEstanqueL: aNumero(vehiculo.capacidadEstanqueL ?? null),
      fuenteCombustibleCan: fuenteDesdeFila(vehiculo.fuenteCombustibleCan),
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

  let masAntiguo: number | null = null;
  if (truncado) {
    for (const punto of puntos) {
      if (masAntiguo == null || punto.tMs < masAntiguo) {
        masAntiguo = punto.tMs;
      }
    }
  }

  const todos = segmentarTrayectosTeltonika(puntos, config);
  return {
    empresaId: opts.empresaId,
    desde: opts.desde.toISOString(),
    hasta: opts.hasta.toISOString(),
    vehiculosTeltonika: vehiculos.length,
    truncado,
    coberturaDesde: masAntiguo == null ? null : new Date(masAntiguo).toISOString(),
    puntosLeidos: puntos.length,
    puntosEnVentana,
    cta: null,
    ctaSensor: todos.length > 0 && todos.every((t) => t.ctaSensor),
    ctaCapacidadEstanque: todos.some((t) => t.ctaCapacidadEstanque),
    vehiculos: resumirCombustibleVehiculos(puntos),
    trayectos: todos,
    resumenVehiculo: opts.vehiculoId ? resumirHubVehiculo(todos) : null,
  };
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
  const combustible = opts.combustible ?? 'con_dato';
  const lectura = await leerTrayectosDeLaFlota(opts);
  const conDato = lectura.trayectos.filter((t) => t.fuenteCombustible != null);
  const sinDato = lectura.trayectos.filter((t) => t.fuenteCombustible == null);
  const filtrados = combustible === 'con_dato' ? conDato : sinDato;
  const inicio = (opts.page - 1) * opts.pageSize;
  let pagina = filtrados.slice(inicio, inicio + opts.pageSize);
  if (opts.detalleId) {
    const asegurado = lectura.trayectos.find((t) => t.id === opts.detalleId);
    if (asegurado && !pagina.some((t) => t.id === asegurado.id)) {
      pagina = [asegurado, ...pagina];
    }
  }

  return {
    empresaId: lectura.empresaId,
    desde: lectura.desde,
    hasta: lectura.hasta,
    vehiculosTeltonika: lectura.vehiculosTeltonika,
    truncado: lectura.truncado,
    cta: lectura.cta,
    ctaSensor: lectura.ctaSensor,
    ctaCapacidadEstanque: lectura.ctaCapacidadEstanque,
    combustible,
    page: opts.page,
    pageSize: opts.pageSize,
    total: filtrados.length,
    totalConCombustible: conDato.length,
    totalSinCombustible: sinDato.length,
    vehiculos: lectura.vehiculos,
    trayectos: pagina,
    resumenVehiculo: lectura.resumenVehiculo,
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

const FUENTES_CAN = new Set<FuenteCombustibleCan>(['84', '83', '89', 'sin_sensor']);

/**
 * `undefined` (el mock de un test que no selecciona la columna) conserva el
 * camino legado. `null` y cualquier valor fuera del conjunto = sin_sensor.
 */
function fuenteDesdeFila(valor: string | null | undefined): FuenteCombustibleCan | undefined {
  if (valor === undefined) {
    return undefined;
  }
  if (valor != null && FUENTES_CAN.has(valor as FuenteCombustibleCan)) {
    return valor as FuenteCombustibleCan;
  }
  return 'sin_sensor';
}

function aNumero(valor: string | number | null): number | null {
  if (valor == null) {
    return null;
  }
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}
