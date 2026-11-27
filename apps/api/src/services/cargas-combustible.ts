import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pgConstraintName, pgErrorCode } from '../db/pg-error.js';
import { type CargaCombustibleRow, cargasCombustible } from '../db/schema.js';

/**
 * Registro de cargas de combustible (`.specs/registro-cargas-combustible`).
 * La ruta ya comprobó que el vehículo es de la empresa; acá solo se escribe y
 * se lee. Anular no borra.
 */

/** Carrera o reintento contra `uq_cargas_combustible_vigente` (migración 0093). */
function esCargaDuplicada(err: unknown): boolean {
  return pgErrorCode(err) === '23505' && pgConstraintName(err) === 'uq_cargas_combustible_vigente';
}

export type ResultadoRegistrarCarga =
  | { ok: true; carga: CargaCombustibleRow }
  | { ok: false; code: 'carga_duplicada' };

export async function registrarCargaCombustible(opts: {
  db: Db;
  empresaId: string;
  vehiculoId: string;
  /** Ya truncada al minuto por la ruta. */
  cargadaEn: Date;
  litros: number;
  lugar: string | null;
  registradaPor: string;
}): Promise<ResultadoRegistrarCarga> {
  try {
    const [carga] = await opts.db
      .insert(cargasCombustible)
      .values({
        empresaId: opts.empresaId,
        vehiculoId: opts.vehiculoId,
        cargadaEn: opts.cargadaEn,
        litros: opts.litros,
        lugar: opts.lugar,
        registradaPor: opts.registradaPor,
      })
      .returning();
    if (!carga) {
      throw new Error('insert de cargas_combustible no devolvió la fila');
    }
    return { ok: true, carga };
  } catch (err) {
    if (esCargaDuplicada(err)) {
      return { ok: false, code: 'carga_duplicada' };
    }
    throw err;
  }
}

export async function listarCargasCombustible(opts: {
  db: Db;
  empresaId: string;
  vehiculoId: string;
  limite: number;
}): Promise<CargaCombustibleRow[]> {
  return opts.db
    .select()
    .from(cargasCombustible)
    .where(
      and(
        eq(cargasCombustible.vehiculoId, opts.vehiculoId),
        eq(cargasCombustible.empresaId, opts.empresaId),
        isNull(cargasCombustible.anuladaEn),
      ),
    )
    .orderBy(desc(cargasCombustible.cargadaEn))
    .limit(opts.limite);
}

/**
 * Anula una carga del vehículo y la empresa dados. Si ya estaba anulada la
 * devuelve igual (idempotente). Null si no existe para ese vehículo y empresa.
 */
export async function anularCargaCombustible(opts: {
  db: Db;
  empresaId: string;
  vehiculoId: string;
  cargaId: string;
  anuladaPor: string;
}): Promise<CargaCombustibleRow | null> {
  const deEsteVehiculo = and(
    eq(cargasCombustible.id, opts.cargaId),
    eq(cargasCombustible.vehiculoId, opts.vehiculoId),
    eq(cargasCombustible.empresaId, opts.empresaId),
  );
  const [anulada] = await opts.db
    .update(cargasCombustible)
    .set({ anuladaEn: new Date(), anuladaPor: opts.anuladaPor })
    .where(and(deEsteVehiculo, isNull(cargasCombustible.anuladaEn)))
    .returning();
  if (anulada) {
    return anulada;
  }
  const [existente] = await opts.db.select().from(cargasCombustible).where(deEsteVehiculo).limit(1);
  return existente ?? null;
}
