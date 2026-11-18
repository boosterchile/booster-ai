import type { Logger } from '@booster-ai/logger';
import {
  CONFIGURACION_BOOSTER_FLEET,
  type ConductorBoosterFleet,
  type DocumentoBoosterFleet,
  type MantencionBoosterFleet,
  type MantencionEntrada,
  type PanelBoosterFleet,
  type ProgramarMantencionInput,
  type VehiculoBoosterFleet,
  clasificarMantencion,
  componerPanelBoosterFleet,
  fechaEnZona,
  tipoMantencionSchema,
} from '@booster-ai/shared-schemas';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  conductores,
  documentosConductor,
  documentosVehiculo,
  empresas,
  mantencionesVehiculo,
  users,
  vehicles,
} from '../db/schema.js';
import { getBusinessHistogram } from '../observability/business-metrics.js';
import { PRESUPUESTO_PUNTOS_PANEL, leerTrayectosDeLaFlota } from './listar-trayectos-teltonika.js';

const MS_DIA = 86_400_000;

const puntosLeidos = getBusinessHistogram('booster_fleet_puntos_leidos', {
  description: 'Puntos de telemetría que leyó el panel de Booster Fleet en una consulta',
});
const duracionLectura = getBusinessHistogram('booster_fleet_lectura_combustible_ms', {
  description: 'Duración de la lectura de combustible del panel de Booster Fleet',
  unit: 'ms',
});
const TOPE_MANTENCIONES = 500;
const ZONA_FALLBACK = 'America/Santiago';

type FilaMantencion = typeof mantencionesVehiculo.$inferSelect;

function aFecha(valor: Date | string | null): string | null {
  if (valor == null) {
    return null;
  }
  if (typeof valor === 'string') {
    return valor.slice(0, 10);
  }
  if (Number.isNaN(valor.getTime())) {
    return null;
  }
  return valor.toISOString().slice(0, 10);
}

function aIso(valor: Date | null): string | null {
  if (valor == null || Number.isNaN(valor.getTime())) {
    return null;
  }
  return valor.toISOString();
}

async function leerZona(db: Db, empresaId: string): Promise<string> {
  const filas = await db
    .select({ timezone: empresas.timezone })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  const zona = filas[0]?.timezone;
  return zona && zona.length > 0 ? zona : ZONA_FALLBACK;
}

function filaMantencion(fila: FilaMantencion, patente: string): MantencionEntrada {
  return {
    id: fila.id,
    vehiculoId: fila.vehiculoId,
    patente,
    tipo: tipoMantencionSchema.parse(fila.tipo),
    titulo: fila.titulo,
    programadaPara: fila.programadaPara,
    kilometrajeObjetivo: fila.kilometrajeObjetivo,
    realizadaEn: aIso(fila.realizadaEn),
    canceladaEn: aIso(fila.canceladaEn),
    notas: fila.notas,
  };
}

export async function armarPanelBoosterFleet(opts: {
  db: Db;
  logger: Logger;
  empresaId: string;
  ahora?: Date;
  leerCombustible?: typeof leerTrayectosDeLaFlota;
  /** Puntos de telemetría que puede leer la consulta. Por defecto, el presupuesto del panel. */
  presupuestoPuntos?: number | undefined;
}): Promise<PanelBoosterFleet> {
  const ahora = opts.ahora ?? new Date();
  const zona = await leerZona(opts.db, opts.empresaId);
  const hoy = fechaEnZona(ahora, zona);
  const hasta = ahora;
  const desde = new Date(
    hasta.getTime() - CONFIGURACION_BOOSTER_FLEET.ventanaCombustibleDias * MS_DIA,
  );

  const flota = await opts.db
    .select({
      id: vehicles.id,
      patente: vehicles.plate,
      estado: vehicles.vehicleStatus,
      teltonikaImei: vehicles.teltonikaImei,
    })
    .from(vehicles)
    .where(and(eq(vehicles.empresaId, opts.empresaId), ne(vehicles.vehicleStatus, 'retirado')));

  const docsVehiculo = await opts.db
    .select({
      duenoId: documentosVehiculo.vehicleId,
      tipo: documentosVehiculo.tipo,
      fechaVencimiento: documentosVehiculo.fechaVencimiento,
    })
    .from(documentosVehiculo)
    .innerJoin(vehicles, eq(vehicles.id, documentosVehiculo.vehicleId))
    .where(eq(vehicles.empresaId, opts.empresaId));

  const fichas = await opts.db
    .select({
      id: conductores.id,
      nombre: users.fullName,
      rut: users.rut,
      licenciaVencimiento: conductores.licenseExpiry,
    })
    .from(conductores)
    .innerJoin(users, eq(users.id, conductores.userId))
    .where(and(eq(conductores.empresaId, opts.empresaId), isNull(conductores.deletedAt)));

  const docsConductor = await opts.db
    .select({
      duenoId: documentosConductor.conductorId,
      tipo: documentosConductor.tipo,
      fechaVencimiento: documentosConductor.fechaVencimiento,
    })
    .from(documentosConductor)
    .innerJoin(conductores, eq(conductores.id, documentosConductor.conductorId))
    .where(and(eq(conductores.empresaId, opts.empresaId), isNull(conductores.deletedAt)));

  const filasMantencion = await opts.db
    .select({
      mantencion: mantencionesVehiculo,
      patente: vehicles.plate,
    })
    .from(mantencionesVehiculo)
    .innerJoin(vehicles, eq(vehicles.id, mantencionesVehiculo.vehiculoId))
    .where(
      and(
        eq(mantencionesVehiculo.empresaId, opts.empresaId),
        isNull(mantencionesVehiculo.canceladaEn),
      ),
    )
    .orderBy(desc(mantencionesVehiculo.programadaPara))
    .limit(TOPE_MANTENCIONES + 1);

  const leer = opts.leerCombustible ?? leerTrayectosDeLaFlota;
  const inicioLectura = Date.now();
  const lectura = await leer({
    db: opts.db,
    logger: opts.logger,
    empresaId: opts.empresaId,
    desde,
    hasta,
    reparto: 'por_vehiculo',
    maxPuntos: opts.presupuestoPuntos ?? PRESUPUESTO_PUNTOS_PANEL,
  });
  const resultado = lectura.truncado ? 'truncado' : 'completo';
  duracionLectura.record(Date.now() - inicioLectura, { resultado, origen: 'base' });
  puntosLeidos.record(lectura.puntosLeidos, { resultado });

  const vehiculos: VehiculoBoosterFleet[] = flota.map((fila) => ({
    id: fila.id,
    patente: fila.patente,
    estado: fila.estado,
    tieneTeltonika: fila.teltonikaImei != null,
  }));
  const documentosVehiculoEntrada: DocumentoBoosterFleet[] = docsVehiculo.map((fila) => ({
    duenoId: fila.duenoId,
    tipo: fila.tipo,
    fechaVencimiento: aFecha(fila.fechaVencimiento),
  }));
  const conductoresEntrada: ConductorBoosterFleet[] = fichas.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    rut: fila.rut ?? '',
    licenciaVencimiento: fila.licenciaVencimiento,
  }));
  const documentosConductorEntrada: DocumentoBoosterFleet[] = docsConductor.map((fila) => ({
    duenoId: fila.duenoId,
    tipo: fila.tipo,
    fechaVencimiento: aFecha(fila.fechaVencimiento),
  }));
  const mantenciones = filasMantencion
    .slice(0, TOPE_MANTENCIONES)
    .map((fila) => filaMantencion(fila.mantencion, fila.patente));

  return componerPanelBoosterFleet({
    hoy,
    desde: lectura.desde,
    hasta: lectura.hasta,
    truncado: lectura.truncado,
    coberturaDesde: lectura.coberturaDesde,
    mantencionesTruncadas: filasMantencion.length > TOPE_MANTENCIONES,
    vehiculos,
    trayectos: lectura.trayectos.map((trayecto) => ({
      id: trayecto.id,
      inicio: trayecto.inicio,
      fin: trayecto.fin,
      eventoDesde: trayecto.eventoDesde,
      eventoHasta: trayecto.eventoHasta,
      eventoLitros: trayecto.eventoLitros,
      eventLat: trayecto.eventLat,
      eventLon: trayecto.eventLon,
      vehiculoId: trayecto.vehiculoId,
      litrosConsumidos: trayecto.litrosConsumidos,
      kmCubiertos: trayecto.kmCubiertos,
      kmPorLitro: trayecto.kmPorLitro,
      notaCombustible: trayecto.notaCombustible,
      posibleRoboCombustible: trayecto.posibleRoboCombustible,
      posibleRoboHormiga: trayecto.posibleRoboHormiga,
      ctaCapacidadEstanque: trayecto.ctaCapacidadEstanque,
      fuenteCombustible: trayecto.fuenteCombustible,
    })),
    documentosVehiculo: documentosVehiculoEntrada,
    conductores: conductoresEntrada,
    documentosConductor: documentosConductorEntrada,
    mantenciones,
  });
}

async function patenteDe(db: Db, empresaId: string, vehiculoId: string): Promise<string> {
  const filas = await db
    .select({ plate: vehicles.plate })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehiculoId), eq(vehicles.empresaId, empresaId)))
    .limit(1);
  return filas[0]?.plate ?? '';
}

export async function programarMantencion(opts: {
  db: Db;
  logger: Logger;
  empresaId: string;
  input: ProgramarMantencionInput;
  ahora?: Date;
}): Promise<
  { ok: true; mantencion: MantencionBoosterFleet } | { ok: false; code: 'vehiculo_no_encontrado' }
> {
  const ahora = opts.ahora ?? new Date();
  const candidatos = await opts.db
    .select({ id: vehicles.id, plate: vehicles.plate })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, opts.input.vehiculo_id),
        eq(vehicles.empresaId, opts.empresaId),
        ne(vehicles.vehicleStatus, 'retirado'),
      ),
    )
    .limit(1);
  const vehiculo = candidatos[0];
  if (!vehiculo) {
    return { ok: false, code: 'vehiculo_no_encontrado' };
  }

  const insertadas = await opts.db
    .insert(mantencionesVehiculo)
    .values({
      empresaId: opts.empresaId,
      vehiculoId: vehiculo.id,
      tipo: opts.input.tipo,
      titulo: opts.input.titulo,
      programadaPara: opts.input.programada_para,
      kilometrajeObjetivo: opts.input.kilometraje_objetivo ?? null,
      notas: opts.input.notas ?? null,
    })
    .returning();
  const fila = insertadas[0];
  if (!fila) {
    throw new Error('booster-fleet: la mantención no volvió después de insertarla');
  }
  const zona = await leerZona(opts.db, opts.empresaId);
  const clasificada = clasificarMantencion(
    filaMantencion(fila, vehiculo.plate),
    fechaEnZona(ahora, zona),
  );
  if (!clasificada) {
    throw new Error('booster-fleet: una mantención recién creada no puede estar cancelada');
  }
  opts.logger.info(
    { empresaId: opts.empresaId, vehiculoId: vehiculo.id, mantencionId: fila.id },
    'booster-fleet: mantención programada',
  );
  return { ok: true, mantencion: clasificada };
}

export async function cerrarMantencion(opts: {
  db: Db;
  logger: Logger;
  empresaId: string;
  mantencionId: string;
  accion: 'realizar' | 'cancelar';
  kilometrajeRealizado?: number | undefined;
  ahora?: Date;
}): Promise<
  | { ok: true; mantencion: MantencionBoosterFleet | null }
  | { ok: false; code: 'no_encontrada' | 'ya_cerrada' }
> {
  const ahora = opts.ahora ?? new Date();
  const cierre =
    opts.accion === 'realizar'
      ? {
          realizadaEn: ahora,
          updatedAt: ahora,
          ...(opts.kilometrajeRealizado != null
            ? { kilometrajeRealizado: opts.kilometrajeRealizado }
            : {}),
        }
      : { canceladaEn: ahora, updatedAt: ahora };
  const actualizadas = await opts.db
    .update(mantencionesVehiculo)
    .set(cierre)
    .where(
      and(
        eq(mantencionesVehiculo.id, opts.mantencionId),
        eq(mantencionesVehiculo.empresaId, opts.empresaId),
        isNull(mantencionesVehiculo.realizadaEn),
        isNull(mantencionesVehiculo.canceladaEn),
      ),
    )
    .returning();
  const fila = actualizadas[0];
  if (!fila) {
    const existentes = await opts.db
      .select({ id: mantencionesVehiculo.id })
      .from(mantencionesVehiculo)
      .where(
        and(
          eq(mantencionesVehiculo.id, opts.mantencionId),
          eq(mantencionesVehiculo.empresaId, opts.empresaId),
        ),
      )
      .limit(1);
    return { ok: false, code: existentes[0] ? 'ya_cerrada' : 'no_encontrada' };
  }

  const patente = await patenteDe(opts.db, opts.empresaId, fila.vehiculoId);
  const zona = await leerZona(opts.db, opts.empresaId);
  const clasificada = clasificarMantencion(filaMantencion(fila, patente), fechaEnZona(ahora, zona));
  opts.logger.info(
    {
      empresaId: opts.empresaId,
      mantencionId: fila.id,
      accion: opts.accion,
    },
    'booster-fleet: mantención cerrada',
  );
  return { ok: true, mantencion: clasificada };
}
