import type { TipoSolicitudBooster } from '@booster-ai/shared-schemas';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pgErrorCode } from '../db/pg-error.js';
import { type SolicitudBoosterRow, empresas, solicitudesBooster, vehicles } from '../db/schema.js';

/**
 * «Pedir a Booster» (`.specs/frente2-cierre` §3.4, migración 0091). La empresa
 * pide al personal de Booster una configuración; el personal la ve en su
 * panel y la marca resuelta.
 */

/** Tope de la lista del panel: las abiertas son pocas; el tope protege la respuesta. */
const MAX_ABIERTAS = 500;

/**
 * Crea la solicitud abierta del vehículo para ese tipo, o devuelve la que ya
 * estaba abierta. El índice único parcial
 * `uq_solicitudes_booster_vehiculo_tipo_abierta` cierra la carrera entre dos
 * pedidos simultáneos: el que pierde lee la del que ganó.
 *
 * El caller ya comprobó que el vehículo es de `empresaId`.
 */
export async function pedirABooster(opts: {
  db: Db;
  empresaId: string;
  vehiculoId: string;
  tipo: TipoSolicitudBooster;
  creadaPor: string;
}): Promise<{ solicitud: SolicitudBoosterRow; creada: boolean }> {
  const { db, empresaId, vehiculoId, tipo, creadaPor } = opts;
  const abierta = async () => {
    const [fila] = await db
      .select()
      .from(solicitudesBooster)
      .where(
        and(
          eq(solicitudesBooster.empresaId, empresaId),
          eq(solicitudesBooster.vehiculoId, vehiculoId),
          eq(solicitudesBooster.tipo, tipo),
          eq(solicitudesBooster.estado, 'abierta'),
        ),
      )
      .limit(1);
    return fila;
  };

  const existente = await abierta();
  if (existente) {
    return { solicitud: existente, creada: false };
  }
  try {
    const [creada] = await db
      .insert(solicitudesBooster)
      .values({ empresaId, vehiculoId, tipo, creadaPor })
      .returning();
    if (!creada) {
      throw new Error('insert de solicitudes_booster no devolvió la fila');
    }
    return { solicitud: creada, creada: true };
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      const ganadora = await abierta();
      if (ganadora) {
        return { solicitud: ganadora, creada: false };
      }
    }
    throw err;
  }
}

export interface SolicitudAbiertaConDatos {
  id: string;
  tipo: string;
  empresaId: string;
  empresaNombre: string;
  vehiculoId: string | null;
  patente: string | null;
  creadaEn: Date;
}

/** Las solicitudes abiertas de todas las empresas, la más antigua primero. */
export async function listarSolicitudesAbiertas(db: Db): Promise<SolicitudAbiertaConDatos[]> {
  // rls-allowlist: lista del panel de plataforma sobre todas las empresas — la ruta exige requirePlatformAdmin.
  return await db
    .select({
      id: solicitudesBooster.id,
      tipo: solicitudesBooster.tipo,
      empresaId: solicitudesBooster.empresaId,
      empresaNombre: empresas.legalName,
      vehiculoId: solicitudesBooster.vehiculoId,
      patente: vehicles.plate,
      creadaEn: solicitudesBooster.creadaEn,
    })
    .from(solicitudesBooster)
    .innerJoin(empresas, eq(empresas.id, solicitudesBooster.empresaId))
    .leftJoin(vehicles, eq(vehicles.id, solicitudesBooster.vehiculoId))
    .where(eq(solicitudesBooster.estado, 'abierta'))
    .orderBy(asc(solicitudesBooster.creadaEn))
    .limit(MAX_ABIERTAS);
}

export type ResultadoResolver =
  | { resultado: 'resuelta'; solicitud: SolicitudBoosterRow }
  | { resultado: 'ya_resuelta' }
  | { resultado: 'no_existe' };

/**
 * Marca resuelta una solicitud abierta, con quién y cuándo. El `WHERE estado =
 * 'abierta'` hace que dos personas no la resuelvan dos veces: la segunda ve
 * `ya_resuelta`.
 */
export async function resolverSolicitud(opts: {
  db: Db;
  id: string;
  resueltaPor: string;
}): Promise<ResultadoResolver> {
  const { db, id, resueltaPor } = opts;
  // rls-allowlist: el personal de Booster resuelve solicitudes de cualquier empresa — la ruta exige requirePlatformAdmin.
  const [resuelta] = await db
    .update(solicitudesBooster)
    .set({ estado: 'resuelta', resueltaEn: new Date(), resueltaPor })
    .where(and(eq(solicitudesBooster.id, id), eq(solicitudesBooster.estado, 'abierta')))
    .returning();
  if (resuelta) {
    return { resultado: 'resuelta', solicitud: resuelta };
  }
  // rls-allowlist: distingue una ya resuelta de una que no existe, por id — la ruta exige requirePlatformAdmin.
  const [existe] = await db
    .select({ id: solicitudesBooster.id })
    .from(solicitudesBooster)
    .where(eq(solicitudesBooster.id, id))
    .limit(1);
  return existe ? { resultado: 'ya_resuelta' } : { resultado: 'no_existe' };
}
