import { puedeTransicionarRuta } from '@booster-ai/route-planner';
import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type AssignmentRow,
  type RutaRow,
  assignments,
  eventosRuta,
  paradasRuta,
  rutas,
} from '../db/schema.js';

/**
 * Relleno de rutas (ADR-088, spec ruta-parada-servicio parte 3).
 *
 * Deja cada asignación con una ruta de dos paradas en el estado que le
 * corresponde:
 *
 * - a la asignación sin ruta (anterior a la migración 0078) le crea una;
 * - a la ruta que creó el accept y cuya asignación avanzó después, la pone al
 *   día. Hasta la parte 4 de la spec, confirmar la recogida o la entrega y
 *   asignar conductor escriben solo en la asignación.
 *
 * Es idempotente: una segunda corrida no encuentra nada que hacer. Todo ocurre
 * en una transacción; en seco se deshace al final.
 */

export type AsignacionParaRuta = Pick<
  AssignmentRow,
  'status' | 'driverUserId' | 'pickedUpAt' | 'deliveredAt' | 'cancelledAt'
>;

export interface PlanRuta {
  readonly estado: RutaRow['status'];
  readonly iniciadaEn: Date | null;
  readonly cerradaEn: Date | null;
  readonly canceladaEn: Date | null;
  readonly recogidaResueltaEn: Date | null;
  readonly entregaResueltaEn: Date | null;
}

export type RutaQueCorresponde =
  | { readonly ok: true; readonly plan: PlanRuta }
  | { readonly ok: false; readonly motivo: string };

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

const SIN_FECHAS = {
  iniciadaEn: null,
  cerradaEn: null,
  canceladaEn: null,
  recogidaResueltaEn: null,
  entregaResueltaEn: null,
} as const;

/**
 * El estado de ruta y las fechas que le corresponden a una asignación que
 * viaja sola. Si a la asignación le falta un dato que su estado exige, no se
 * inventa: se devuelve el motivo y la asignación queda sin rellenar.
 */
export function rutaQueCorresponde(a: AsignacionParaRuta): RutaQueCorresponde {
  switch (a.status) {
    case 'asignado':
      return { ok: true, plan: { estado: 'planificada', ...SIN_FECHAS } };
    case 'recogido':
      if (!a.pickedUpAt) {
        return { ok: false, motivo: 'recogida sin fecha de recogida' };
      }
      if (!a.driverUserId) {
        // Invariante 4 de la spec: una ruta en curso tiene conductor.
        return { ok: false, motivo: 'recogida sin conductor: la ruta en curso lo exige' };
      }
      return {
        ok: true,
        plan: {
          ...SIN_FECHAS,
          estado: 'en_curso',
          iniciadaEn: a.pickedUpAt,
          recogidaResueltaEn: a.pickedUpAt,
        },
      };
    case 'entregado':
      if (!a.pickedUpAt) {
        return { ok: false, motivo: 'entregada sin fecha de recogida' };
      }
      if (!a.deliveredAt) {
        return { ok: false, motivo: 'entregada sin fecha de entrega' };
      }
      return {
        ok: true,
        plan: {
          ...SIN_FECHAS,
          estado: 'cerrada',
          iniciadaEn: a.pickedUpAt,
          cerradaEn: a.deliveredAt,
          recogidaResueltaEn: a.pickedUpAt,
          entregaResueltaEn: a.deliveredAt,
        },
      };
    case 'cancelado':
      if (!a.cancelledAt) {
        return { ok: false, motivo: 'cancelada sin fecha de cancelación' };
      }
      if (a.pickedUpAt) {
        // La ruta alcanzó a empezar: no se cancela, se cierra (§4.3).
        return {
          ok: true,
          plan: {
            ...SIN_FECHAS,
            estado: 'cerrada',
            iniciadaEn: a.pickedUpAt,
            cerradaEn: a.cancelledAt,
            recogidaResueltaEn: a.pickedUpAt,
          },
        };
      }
      return {
        ok: true,
        plan: { ...SIN_FECHAS, estado: 'cancelada', canceladaEn: a.cancelledAt },
      };
  }
}

/** ¿Se llega de `desde` a `hacia` siguiendo las transiciones de la ruta? */
function alcanzable(desde: RutaRow['status'], hacia: RutaRow['status']): boolean {
  if (desde === hacia || puedeTransicionarRuta(desde, hacia)) {
    return true;
  }
  // planificada → en_curso → cerrada: la asignación pudo recogerse y
  // entregarse entre dos corridas.
  return puedeTransicionarRuta(desde, 'en_curso') && puedeTransicionarRuta('en_curso', hacia);
}

const mismaFecha = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Fila = Pick<
  AssignmentRow,
  | 'id'
  | 'tripId'
  | 'empresaId'
  | 'vehicleId'
  | 'unidadArrastreId'
  | 'driverUserId'
  | 'rutaId'
  | 'status'
  | 'acceptedAt'
  | 'pickedUpAt'
  | 'deliveredAt'
  | 'cancelledAt'
>;

async function crearRuta(tx: Tx, a: Fila, plan: PlanRuta): Promise<string> {
  const [ruta] = await tx
    .insert(rutas)
    .values({
      empresaId: a.empresaId,
      vehicleId: a.vehicleId,
      unidadArrastreId: a.unidadArrastreId,
      driverUserId: a.driverUserId,
      status: plan.estado,
      startedAt: plan.iniciadaEn,
      closedAt: plan.cerradaEn,
      cancelledAt: plan.canceladaEn,
      // La ruta existe desde que se aceptó la oferta, no desde el relleno.
      createdAt: a.acceptedAt,
    })
    .returning({ id: rutas.id });
  if (!ruta) {
    throw new Error('Insert ruta returned no row');
  }
  await tx.insert(paradasRuta).values([
    {
      rutaId: ruta.id,
      orden: 0,
      tipo: 'recogida',
      tripId: a.tripId,
      resolvedAt: plan.recogidaResueltaEn,
    },
    {
      rutaId: ruta.id,
      orden: 1,
      tipo: 'entrega',
      tripId: a.tripId,
      resolvedAt: plan.entregaResueltaEn,
    },
  ]);
  await tx.insert(eventosRuta).values({
    rutaId: ruta.id,
    tipo: 'ruta_creada',
    payload: { viaje_id: a.tripId, asignacion_id: a.id, origen: 'relleno' },
    recordedByUserId: null,
  });
  // rls-allowlist: relleno de plataforma sobre todas las empresas; fila tomada por id con FOR UPDATE
  await tx.update(assignments).set({ rutaId: ruta.id }).where(eq(assignments.id, a.id));
  return ruta.id;
}

type Conciliacion =
  | { readonly tipo: 'sin_cambios' }
  | { readonly tipo: 'conciliada'; readonly desde: RutaRow['status'] }
  | { readonly tipo: 'omitida'; readonly motivo: string };

async function conciliarRuta(
  tx: Tx,
  a: Fila,
  rutaId: string,
  plan: PlanRuta,
): Promise<Conciliacion> {
  // rls-allowlist: relleno de plataforma; la ruta se toma por el id que guarda la asignación
  const [ruta] = await tx.select().from(rutas).where(eq(rutas.id, rutaId)).for('update');
  if (!ruta) {
    throw new Error(`La asignación ${a.id} apunta a una ruta que no existe`);
  }
  // rls-allowlist: paradas de la ruta recién tomada por id
  const paradas = await tx
    .select()
    .from(paradasRuta)
    .where(eq(paradasRuta.rutaId, rutaId))
    .orderBy(asc(paradasRuta.orden));
  const recogida = paradas.find((p) => p.tipo === 'recogida' && p.tripId === a.tripId);
  const entrega = paradas.find((p) => p.tipo === 'entrega' && p.tripId === a.tripId);
  if (paradas.length !== 2 || !recogida || !entrega) {
    return { tipo: 'omitida', motivo: 'la ruta tiene paradas de otros servicios' };
  }
  if (!alcanzable(ruta.status, plan.estado)) {
    return {
      tipo: 'omitida',
      motivo: `la ruta está ${ruta.status} y la asignación pide ${plan.estado}`,
    };
  }

  const cambiaEstado = ruta.status !== plan.estado;
  const cambiaConfiguracion =
    ruta.vehicleId !== a.vehicleId ||
    ruta.unidadArrastreId !== a.unidadArrastreId ||
    ruta.driverUserId !== a.driverUserId;
  const cambiaFechas =
    !mismaFecha(ruta.startedAt, plan.iniciadaEn) ||
    !mismaFecha(ruta.closedAt, plan.cerradaEn) ||
    !mismaFecha(ruta.cancelledAt, plan.canceladaEn) ||
    !mismaFecha(recogida.resolvedAt, plan.recogidaResueltaEn) ||
    !mismaFecha(entrega.resolvedAt, plan.entregaResueltaEn);
  if (!cambiaEstado && !cambiaConfiguracion && !cambiaFechas) {
    return { tipo: 'sin_cambios' };
  }

  // rls-allowlist: ruta tomada por id con FOR UPDATE en esta transacción
  await tx
    .update(rutas)
    .set({
      vehicleId: a.vehicleId,
      unidadArrastreId: a.unidadArrastreId,
      driverUserId: a.driverUserId,
      status: plan.estado,
      startedAt: plan.iniciadaEn,
      closedAt: plan.cerradaEn,
      cancelledAt: plan.canceladaEn,
      updatedAt: sql`now()`,
    })
    .where(eq(rutas.id, rutaId));
  // rls-allowlist: paradas por id, de la ruta tomada en esta transacción
  await tx
    .update(paradasRuta)
    .set({ resolvedAt: plan.recogidaResueltaEn })
    .where(eq(paradasRuta.id, recogida.id));
  // rls-allowlist: paradas por id, de la ruta tomada en esta transacción
  await tx
    .update(paradasRuta)
    .set({ resolvedAt: plan.entregaResueltaEn })
    .where(eq(paradasRuta.id, entrega.id));
  if (cambiaEstado) {
    await tx.insert(eventosRuta).values({
      rutaId,
      tipo: 'estado_cambiado',
      payload: { desde: ruta.status, hacia: plan.estado, origen: 'relleno' },
      recordedByUserId: null,
    });
  }
  if (cambiaConfiguracion) {
    await tx.insert(eventosRuta).values({
      rutaId,
      tipo: 'configuracion_declarada',
      payload: {
        vehiculo_id: a.vehicleId,
        unidad_arrastre_id: a.unidadArrastreId,
        conductor_id: a.driverUserId,
        origen: 'relleno',
      },
      recordedByUserId: null,
    });
  }
  return { tipo: 'conciliada', desde: ruta.status };
}

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
      const filas: Fila[] = await tx
        .select({
          id: assignments.id,
          tripId: assignments.tripId,
          empresaId: assignments.empresaId,
          vehicleId: assignments.vehicleId,
          unidadArrastreId: assignments.unidadArrastreId,
          driverUserId: assignments.driverUserId,
          rutaId: assignments.rutaId,
          status: assignments.status,
          acceptedAt: assignments.acceptedAt,
          pickedUpAt: assignments.pickedUpAt,
          deliveredAt: assignments.deliveredAt,
          cancelledAt: assignments.cancelledAt,
        })
        // rls-allowlist: relleno de plataforma sobre todas las empresas (job manual, parte 3 de ADR-088)
        .from(assignments)
        .orderBy(asc(assignments.acceptedAt), asc(assignments.id))
        .for('update');
      revisadas = filas.length;

      for (const a of filas) {
        const corresponde = rutaQueCorresponde(a);
        if (!corresponde.ok) {
          omitidas.push({ asignacionId: a.id, motivo: corresponde.motivo });
          continue;
        }
        const { plan } = corresponde;
        if (a.rutaId === null) {
          const rutaId = await crearRuta(tx, a, plan);
          creadas.push({ asignacionId: a.id, rutaId, estado: plan.estado });
          continue;
        }
        const r = await conciliarRuta(tx, a, a.rutaId, plan);
        if (r.tipo === 'omitida') {
          omitidas.push({ asignacionId: a.id, motivo: r.motivo });
        } else if (r.tipo === 'conciliada') {
          conciliadas.push({
            asignacionId: a.id,
            rutaId: a.rutaId,
            desde: r.desde,
            hacia: plan.estado,
          });
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
