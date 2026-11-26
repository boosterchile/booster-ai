import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { vehiculoDeAsignacion } from '../db/configuracion-de-asignacion.js';
import { assignments, empresas, tripMetrics, trips, vehicles } from '../db/schema.js';
import { documentalDeEmpresa } from './documental-flota.js';
import { type ResumenCertificados, resumenCertificados } from './resumen-certificados.js';

/**
 * Indicadores del negocio para el Inicio del panel de administración
 * (frente 10 del rediseño; los pide el frente 1 para que la prueba de
 * coherencia tenga cifras que comparar). Cada cifra sale del mismo cálculo
 * que la pantalla de la empresa que la muestra:
 *
 * - documentos pendientes: `documentalDeEmpresa`, el de Booster Fleet y
 *   Cumplimiento;
 * - certificados y emisiones certificadas: `resumenCertificados`, el de
 *   `GET /certificates`;
 * - camiones: los vehículos no retirados, la flota de Booster Fleet.
 */
export interface IndicadoresNegocio {
  /** Null cuando los indicadores son de una sola empresa. */
  empresas_activas: number | null;
  cargas: number;
  camiones: number;
  camiones_con_huella_medida: number;
  certificados: ResumenCertificados;
  documentos_pendientes: number;
}

export async function indicadoresNegocio(opts: {
  db: Db;
  /** Sin ella, toda la plataforma. */
  empresaId?: string | undefined;
  ahora?: Date | undefined;
}): Promise<IndicadoresNegocio> {
  const { db, empresaId } = opts;
  const activa = eq(empresas.status, 'activa');

  // rls-allowlist: indicadores de plataforma para el panel de administración (requirePlatformAdmin); con `empresaId` cada consulta filtra por esa empresa.
  const transportistas = await db
    .select({ id: empresas.id })
    .from(empresas)
    .where(
      empresaId ? eq(empresas.id, empresaId) : and(activa, eq(empresas.isTransportista, true)),
    );

  let empresasActivas: number | null = null;
  if (!empresaId) {
    // rls-allowlist: conteo de empresas activas de la plataforma, panel de administración.
    const filas = await db.select({ n: sql<string>`count(*)` }).from(empresas).where(activa);
    empresasActivas = Number(filas[0]?.n ?? 0);
  }

  // rls-allowlist: cargas de la plataforma o de la empresa generadora pedida, panel de administración.
  const filasCargas = await db
    .select({ n: sql<string>`count(*)` })
    .from(trips)
    .where(empresaId ? eq(trips.generadorCargaEmpresaId, empresaId) : undefined);

  const noRetirado = ne(vehicles.vehicleStatus, 'retirado');
  // rls-allowlist: camiones de la plataforma o de la empresa pedida, panel de administración.
  const filasCamiones = await db
    .select({ n: sql<string>`count(*)` })
    .from(vehicles)
    .where(empresaId ? and(eq(vehicles.empresaId, empresaId), noRetirado) : noRetirado);

  const medido = and(
    isNotNull(tripMetrics.certificateIssuedAt),
    eq(tripMetrics.certificationLevel, 'primario_verificable'),
  );
  // rls-allowlist: camiones con al menos un certificado medido, de la plataforma o de la empresa transportista pedida, panel de administración.
  const filasMedidos = await db
    .select({ n: sql<string>`count(distinct ${vehiculoDeAsignacion})` })
    .from(assignments)
    .innerJoin(tripMetrics, eq(tripMetrics.tripId, assignments.tripId))
    .where(empresaId ? and(eq(assignments.empresaId, empresaId), medido) : medido);

  let documentosPendientes = 0;
  for (const transportista of transportistas) {
    const { resumen } = await documentalDeEmpresa({
      db,
      empresaId: transportista.id,
      ahora: opts.ahora,
    });
    documentosPendientes += resumen.pendientes;
  }

  return {
    empresas_activas: empresasActivas,
    cargas: Number(filasCargas[0]?.n ?? 0),
    camiones: Number(filasCamiones[0]?.n ?? 0),
    camiones_con_huella_medida: Number(filasMedidos[0]?.n ?? 0),
    certificados: await resumenCertificados({ db, empresaId }),
    documentos_pendientes: documentosPendientes,
  };
}
