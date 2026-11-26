import {
  type FuenteCombustibleCan,
  type TipoSolicitudBooster,
  tipoSolicitudBoosterSchema,
} from '@booster-ai/shared-schemas';
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
/** Las solicitudes abiertas de una empresa, para marcar su camión «Pedido a Booster» en el panel. */
export async function solicitudesAbiertasDeEmpresa(
  db: Db,
  empresaId: string,
): Promise<Array<{ vehiculoId: string; tipo: TipoSolicitudBooster }>> {
  const filas = await db
    .select({ vehiculoId: solicitudesBooster.vehiculoId, tipo: solicitudesBooster.tipo })
    .from(solicitudesBooster)
    .where(
      and(eq(solicitudesBooster.empresaId, empresaId), eq(solicitudesBooster.estado, 'abierta')),
    );
  return filas.flatMap((f) => {
    const tipo = tipoSolicitudBoosterSchema.safeParse(f.tipo);
    return f.vehiculoId && tipo.success ? [{ vehiculoId: f.vehiculoId, tipo: tipo.data }] : [];
  });
}

export async function resolverSolicitud(opts: {
  db: Db;
  id: string;
  resueltaPor: string;
  /**
   * Fuente CAN que el personal de Booster configuró al resolver una solicitud
   * `configurar_fuente_combustible`. Se escribe en el vehículo de la
   * solicitud en la misma transacción: el dueño ya no la edita y la
   * impersonación no escribe en empresas reales.
   */
  fuenteCombustibleCan?: FuenteCombustibleCan | undefined;
}): Promise<ResultadoResolver> {
  const { db, id, resueltaPor, fuenteCombustibleCan } = opts;
  return await db.transaction(async (tx) => {
    // rls-allowlist: el personal de Booster resuelve solicitudes de cualquier empresa — la ruta exige requirePlatformAdmin.
    const [resuelta] = await tx
      .update(solicitudesBooster)
      .set({ estado: 'resuelta', resueltaEn: new Date(), resueltaPor })
      .where(and(eq(solicitudesBooster.id, id), eq(solicitudesBooster.estado, 'abierta')))
      .returning();
    if (resuelta) {
      if (
        fuenteCombustibleCan &&
        resuelta.tipo === 'configurar_fuente_combustible' &&
        resuelta.vehiculoId
      ) {
        // rls-allowlist: el vehículo es el de la solicitud recién resuelta (misma empresa); la ruta exige requirePlatformAdmin.
        await tx
          .update(vehicles)
          .set({ fuenteCombustibleCan, updatedAt: new Date() })
          .where(
            and(eq(vehicles.id, resuelta.vehiculoId), eq(vehicles.empresaId, resuelta.empresaId)),
          );
      }
      return { resultado: 'resuelta', solicitud: resuelta };
    }
    // rls-allowlist: distingue una ya resuelta de una que no existe, por id — la ruta exige requirePlatformAdmin.
    const [existe] = await tx
      .select({ id: solicitudesBooster.id })
      .from(solicitudesBooster)
      .where(eq(solicitudesBooster.id, id))
      .limit(1);
    return existe ? { resultado: 'ya_resuelta' } : { resultado: 'no_existe' };
  });
}
