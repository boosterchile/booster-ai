import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type RutaRow, assignments, rutas } from '../db/schema.js';
import { COLUMNAS_PARA_RUTA, sincronizarFila } from './sincronizar-ruta-de-asignacion.js';

/**
 * Relleno de rutas (ADR-088, spec ruta-parada-servicio parte 3). La regla de
 * cada asignación vive en sincronizar-ruta-de-asignacion.ts; aquí está el
 * recorrido de todas y la verificación final.
 *
 * Deja cada asignación con una ruta de dos paradas en el estado que le
 * corresponde:
 *
 * - a la asignación sin ruta (anterior a la migración 0078) le crea una;
 * - a la ruta que quedó atrás de su asignación, la pone al día. Desde la parte
 *   4 las escrituras de la asignación sincronizan su ruta; esto cubre las que
 *   se hicieron antes y las que la sincronización omitió.
 *
 * Es idempotente: una segunda corrida no encuentra nada que hacer. Todo ocurre
 * en una transacción; en seco se deshace al final.
 */

export interface ResultadoRelleno {
  readonly dryRun: boolean;
  readonly revisadas: number;
  readonly creadas: { asignacionId: string; rutaId: string; estado: RutaRow['status'] }[];
  readonly conciliadas: {
    asignacionId: string;
    rutaId: string;
    desde: RutaRow['status'];
    hacia: RutaRow['status'];
  }[];
  readonly sinCambios: number;
  readonly omitidas: { asignacionId: string; motivo: string }[];
}

/** La verificación final encontró algo que el relleno no debió dejar. */
export class VerificacionRellenoError extends Error {}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Criterio 3 de la spec: fuera de las omitidas, ninguna asignación queda sin
 * ruta y ninguna ruta difiere de su asignación en empresa, vehículo, arrastre
 * o conductor. Si no se cumple, se deshace todo.
 */
async function verificar(tx: Tx, omitidas: readonly string[]): Promise<void> {
  const fueraDeOmitidas =
    omitidas.length > 0 ? notInArray(assignments.id, [...omitidas]) : sql`true`;
  // rls-allowlist: verificación de plataforma sobre todas las empresas
  const sinRuta = await tx
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(isNull(assignments.rutaId), fueraDeOmitidas));
  // rls-allowlist: verificación de plataforma sobre todas las empresas
  const distintas = await tx
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(rutas, eq(rutas.id, assignments.rutaId))
    .where(
      and(
        fueraDeOmitidas,
        sql`(${rutas.vehicleId} IS DISTINCT FROM ${assignments.vehicleId}
          OR ${rutas.unidadArrastreId} IS DISTINCT FROM ${assignments.unidadArrastreId}
          OR ${rutas.driverUserId} IS DISTINCT FROM ${assignments.driverUserId}
          OR ${rutas.empresaId} IS DISTINCT FROM ${assignments.empresaId})`,
      ),
    );
  if (sinRuta.length > 0 || distintas.length > 0) {
    throw new VerificacionRellenoError(
      `verificación fallida: ${sinRuta.length} asignaciones sin ruta, ${distintas.length} rutas distintas de su asignación; no se escribió nada`,
    );
  }
}

class Deshacer extends Error {}

export async function rellenarRutas(db: Db, opts: { dryRun: boolean }): Promise<ResultadoRelleno> {
  const creadas: ResultadoRelleno['creadas'] = [];
  const conciliadas: ResultadoRelleno['conciliadas'] = [];
  const omitidas: ResultadoRelleno['omitidas'] = [];
  let sinCambios = 0;
  let revisadas = 0;

  try {
    await db.transaction(async (tx) => {
      // rls-allowlist: relleno de plataforma sobre todas las empresas (job manual, parte 3 de ADR-088)
      const filas = await tx
        .select(COLUMNAS_PARA_RUTA)
        .from(assignments)
        .orderBy(asc(assignments.acceptedAt), asc(assignments.id))
        .for('update');
      revisadas = filas.length;

      for (const a of filas) {
        const r = await sincronizarFila(tx, a, { origen: 'relleno', userId: null });
        if (r.tipo === 'creada') {
          creadas.push({ asignacionId: a.id, rutaId: r.rutaId, estado: r.estado });
        } else if (r.tipo === 'conciliada') {
          conciliadas.push({
            asignacionId: a.id,
            rutaId: r.rutaId,
            desde: r.desde,
            hacia: r.hacia,
          });
        } else if (r.tipo === 'omitida') {
          omitidas.push({ asignacionId: a.id, motivo: r.motivo });
        } else {
          sinCambios += 1;
        }
      }

      await verificar(
        tx,
        omitidas.map((o) => o.asignacionId),
      );
      if (opts.dryRun) {
        throw new Deshacer();
      }
    });
  } catch (err) {
    if (!(err instanceof Deshacer)) {
      throw err;
    }
  }

  return { dryRun: opts.dryRun, revisadas, creadas, conciliadas, sinCambios, omitidas };
}
