import {
  type ConductorBoosterFleet,
  type DocumentalFlota,
  type DocumentoBoosterFleet,
  type EntradaDocumental,
  type ResumenDocumental,
  type VehiculoBoosterFleet,
  calcularDocumental,
  fechaEnZona,
  resumirDocumental,
} from '@booster-ai/shared-schemas';
import { type AnyColumn, and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  conductores,
  documentosConductor,
  documentosVehiculo,
  empresas,
  users,
  vehicles,
} from '../db/schema.js';

const ZONA_FALLBACK = 'America/Santiago';

/**
 * `fecha_vencimiento` es `date` en la base, pero el esquema de drizzle la
 * declara `timestamp`: leída tal cual llega como una fecha inválida y todo
 * documento quedaba «sin fecha». Se lee como texto `AAAA-MM-DD`.
 */
function fechaComoTexto(columna: AnyColumn) {
  return sql<string | null>`${columna}::text`;
}

export function aFechaCalendario(valor: Date | string | null): string | null {
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

export async function leerZonaEmpresa(db: Db, empresaId: string): Promise<string> {
  const filas = await db
    .select({ timezone: empresas.timezone })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  const zona = filas[0]?.timezone;
  return zona && zona.length > 0 ? zona : ZONA_FALLBACK;
}

/**
 * El único lector de los documentos de una flota
 * (`.specs/una-sola-verdad-por-dato`). Booster Fleet, Cumplimiento y los
 * indicadores del panel parten de estas mismas filas: vehículos no
 * retirados, conductores no eliminados y los documentos de ambos. «Hoy» es
 * la fecha en la zona horaria de la empresa.
 */
export async function leerEntradaDocumental(opts: {
  db: Db;
  empresaId: string;
  ahora?: Date | undefined;
}): Promise<EntradaDocumental & { vehiculos: VehiculoBoosterFleet[] }> {
  const ahora = opts.ahora ?? new Date();
  const zona = await leerZonaEmpresa(opts.db, opts.empresaId);
  const hoy = fechaEnZona(ahora, zona);

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
      fechaVencimiento: fechaComoTexto(documentosVehiculo.fechaVencimiento),
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
      fechaVencimiento: fechaComoTexto(documentosConductor.fechaVencimiento),
    })
    .from(documentosConductor)
    .innerJoin(conductores, eq(conductores.id, documentosConductor.conductorId))
    .where(and(eq(conductores.empresaId, opts.empresaId), isNull(conductores.deletedAt)));

  const vehiculos: VehiculoBoosterFleet[] = flota.map((fila) => ({
    id: fila.id,
    patente: fila.patente,
    estado: fila.estado,
    tieneTeltonika: fila.teltonikaImei != null,
  }));
  const documentosVehiculoEntrada: DocumentoBoosterFleet[] = docsVehiculo.map((fila) => ({
    duenoId: fila.duenoId,
    tipo: fila.tipo,
    fechaVencimiento: aFechaCalendario(fila.fechaVencimiento),
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
    fechaVencimiento: aFechaCalendario(fila.fechaVencimiento),
  }));

  return {
    hoy,
    vehiculos,
    documentosVehiculo: documentosVehiculoEntrada,
    conductores: conductoresEntrada,
    documentosConductor: documentosConductorEntrada,
  };
}

/** Documentos de la flota de una empresa, con el cálculo único y su resumen. */
export async function documentalDeEmpresa(opts: {
  db: Db;
  empresaId: string;
  ahora?: Date | undefined;
}): Promise<{ documental: DocumentalFlota; resumen: ResumenDocumental }> {
  const documental = calcularDocumental(await leerEntradaDocumental(opts));
  return { documental, resumen: resumirDocumental(documental) };
}
