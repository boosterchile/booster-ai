import type { Logger } from '@booster-ai/logger';
import { estadoQueCorresponde, puedeTransicionarRuta } from '@booster-ai/route-planner';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type AssignmentRow,
  type RutaRow,
  assignments,
  eventosRuta,
  paradasRuta,
  rutas,
} from '../db/schema.js';
import { cargarRuta } from './cargar-ruta.js';

/**
 * La ruta sigue a su asignación (ADR-088, spec ruta-parada-servicio partes 3
 * y 4).
 *
 * Mientras un servicio viaja solo, su ruta de dos paradas es un reflejo de la
 * asignación: mismo vehículo, arrastre y conductor, y el estado que le
 * corresponde. Quien escribe en la asignación (asignar conductor, confirmar
 * recogida o entrega, cancelar) llama a `sincronizarRutaDeAsignacion` en la
 * misma transacción. El job de relleno usa el mismo camino para las
 * asignaciones anteriores a la ruta.
 *
 * Cuando la ruta lleva más de un servicio (parte 5b), la ruta es la fuente de
 * verdad: `conciliarRutaCompartida` resuelve las paradas de cada servicio
 * desde su asignación y mueve el estado con `estadoQueCorresponde` del
 * paquete. El vehículo no se copia de ninguna asignación, y el conductor solo
 * cuando la escritura fue asignar un conductor.
 *
 * Sincronizar nunca rechaza la operación de quien llama: si la ruta no se
 * puede poner al día, devuelve `omitida` con el motivo.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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
 * inventa: se devuelve el motivo.
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
  // entregarse sin que la ruta viera el paso intermedio.
  return puedeTransicionarRuta(desde, 'en_curso') && puedeTransicionarRuta('en_curso', hacia);
}

const mismaFecha = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Lo que la sincronización necesita leer de una asignación. */
export const COLUMNAS_PARA_RUTA = {
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
} as const;

export type FilaParaRuta = Pick<AssignmentRow, keyof typeof COLUMNAS_PARA_RUTA>;

/** Qué escritura de la asignación originó el cambio en la ruta. */
export type OrigenSincronizacion =
  | 'relleno'
  | 'conductor_asignado'
  | 'recogida_confirmada'
  | 'entrega_confirmada'
  | 'carga_cancelada';

export interface ContextoSincronizacion {
  readonly origen: OrigenSincronizacion;
  /** Quién hizo la escritura; `null` en el relleno. */
  readonly userId: string | null;
}

export type ResultadoSincronizacion =
  | { readonly tipo: 'creada'; readonly rutaId: string; readonly estado: RutaRow['status'] }
  | {
      readonly tipo: 'conciliada';
      readonly rutaId: string;
      readonly desde: RutaRow['status'];
      readonly hacia: RutaRow['status'];
    }
  | { readonly tipo: 'sin_cambios'; readonly rutaId: string }
  | { readonly tipo: 'omitida'; readonly motivo: string };

async function crearRuta(
  tx: Tx,
  a: FilaParaRuta,
  plan: PlanRuta,
  ctx: ContextoSincronizacion,
): Promise<string> {
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
      // La ruta existe desde que se aceptó la oferta, no desde que se creó la fila.
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
    payload: { viaje_id: a.tripId, asignacion_id: a.id, origen: ctx.origen },
    recordedByUserId: ctx.userId,
  });
  // rls-allowlist: asignación tomada por id con FOR UPDATE por quien llama, ya autorizado
  await tx.update(assignments).set({ rutaId: ruta.id }).where(eq(assignments.id, a.id));
  return ruta.id;
}

async function conciliarRuta(
  tx: Tx,
  a: FilaParaRuta,
  rutaId: string,
  corresponde: RutaQueCorresponde,
  ctx: ContextoSincronizacion,
): Promise<ResultadoSincronizacion> {
  // rls-allowlist: la ruta se toma por el id que guarda la asignación ya autorizada
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
  if (!recogida || !entrega) {
    return { tipo: 'omitida', motivo: 'la ruta no tiene las paradas de este servicio' };
  }
  if (paradas.length !== 2) {
    return conciliarRutaCompartida(tx, a, ruta, ctx);
  }
  if (corresponde.ok && !alcanzable(ruta.status, corresponde.plan.estado)) {
    return {
      tipo: 'omitida',
      motivo: `la ruta está ${ruta.status} y la asignación pide ${corresponde.plan.estado}`,
    };
  }

  // Si a la asignación le falta un dato para decidir el estado, la ruta
  // conserva el suyo y solo se iguala el vehículo, el arrastre y el conductor.
  const plan: PlanRuta = corresponde.ok
    ? corresponde.plan
    : {
        estado: ruta.status,
        iniciadaEn: ruta.startedAt,
        cerradaEn: ruta.closedAt,
        canceladaEn: ruta.cancelledAt,
        recogidaResueltaEn: recogida.resolvedAt,
        entregaResueltaEn: entrega.resolvedAt,
      };

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

  if (cambiaEstado || cambiaConfiguracion || cambiaFechas) {
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
  }
  if (cambiaEstado) {
    await tx.insert(eventosRuta).values({
      rutaId,
      tipo: 'estado_cambiado',
      payload: { desde: ruta.status, hacia: plan.estado, origen: ctx.origen },
      recordedByUserId: ctx.userId,
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
        origen: ctx.origen,
      },
      recordedByUserId: ctx.userId,
    });
  }

  if (!corresponde.ok) {
    return { tipo: 'omitida', motivo: corresponde.motivo };
  }
  if (!cambiaEstado && !cambiaConfiguracion && !cambiaFechas) {
    return { tipo: 'sin_cambios', rutaId };
  }
  return { tipo: 'conciliada', rutaId, desde: ruta.status, hacia: plan.estado };
}

const MUTABLES = ['asignado', 'recogido'] as const;

function fechaMasTardia(fechas: readonly (Date | null)[]): Date | null {
  const validas = fechas.filter((f): f is Date => f !== null);
  return validas.length === 0 ? null : new Date(Math.max(...validas.map((f) => f.getTime())));
}

function fechaMasTemprana(fechas: readonly (Date | null)[]): Date | null {
  const validas = fechas.filter((f): f is Date => f !== null);
  return validas.length === 0 ? null : new Date(Math.min(...validas.map((f) => f.getTime())));
}

/**
 * Pone al día una ruta con más de un servicio. Reconcilia la ruta entera, no
 * solo el servicio que originó la llamada: así una parada que quedó sin
 * resolver (por ejemplo, una recogida confirmada antes de declarar conductor)
 * se resuelve con la siguiente escritura.
 */
async function conciliarRutaCompartida(
  tx: Tx,
  a: FilaParaRuta,
  ruta: RutaRow,
  ctx: ContextoSincronizacion,
): Promise<ResultadoSincronizacion> {
  const rutaId = ruta.id;

  // El conductor se declara para toda la ruta (decisión D1 del plan): cambia
  // en la ruta y en las demás asignaciones vivas, que son su espejo.
  let conductorId = ruta.driverUserId;
  const cambiaConductor =
    ctx.origen === 'conductor_asignado' && a.driverUserId !== ruta.driverUserId;
  if (cambiaConductor) {
    conductorId = a.driverUserId;
    // rls-allowlist: ruta tomada por id con FOR UPDATE en esta transacción
    await tx
      .update(rutas)
      .set({ driverUserId: conductorId, updatedAt: sql`now()` })
      .where(eq(rutas.id, rutaId));
    // rls-allowlist: asignaciones de la ruta tomada con FOR UPDATE en esta transacción
    await tx
      .update(assignments)
      .set({ driverUserId: conductorId, updatedAt: new Date() })
      .where(and(eq(assignments.rutaId, rutaId), inArray(assignments.status, [...MUTABLES])));
    await tx.insert(eventosRuta).values({
      rutaId,
      tipo: 'configuracion_declarada',
      payload: {
        vehiculo_id: ruta.vehicleId,
        unidad_arrastre_id: ruta.unidadArrastreId,
        conductor_id: conductorId,
        origen: ctx.origen,
      },
      recordedByUserId: ctx.userId,
    });
  }

  // Cada parada toma la fecha que le da la asignación de su servicio.
  const antes = await cargarRuta(tx, rutaId);
  if (!antes) {
    throw new Error(`La ruta ${rutaId} desapareció dentro de la transacción`);
  }
  const deLaRuta = new Set(antes.servicios.map((s) => s.tripId));
  if (antes.paradas.some((p) => !deLaRuta.has(p.tripId))) {
    return {
      tipo: 'omitida',
      motivo: 'la ruta tiene paradas de otros servicios cuya asignación no apunta a ella',
    };
  }
  let omitidas = 0;
  let cambiaronParadas = false;
  for (const servicio of antes.servicios) {
    const corresponde = rutaQueCorresponde({
      status: servicio.estado,
      driverUserId: conductorId,
      pickedUpAt: servicio.pickedUpAt,
      deliveredAt: servicio.deliveredAt,
      cancelledAt: servicio.cancelledAt,
    });
    if (!corresponde.ok) {
      omitidas += 1;
      continue;
    }
    for (const parada of antes.paradas.filter((p) => p.tripId === servicio.tripId)) {
      const fecha =
        parada.tipo === 'recogida'
          ? corresponde.plan.recogidaResueltaEn
          : corresponde.plan.entregaResueltaEn;
      if (!mismaFecha(parada.resolvedAt, fecha)) {
        cambiaronParadas = true;
        // rls-allowlist: parada por id, de la ruta tomada en esta transacción
        await tx
          .update(paradasRuta)
          .set({ resolvedAt: fecha })
          .where(eq(paradasRuta.id, parada.id));
      }
    }
  }

  // El estado sale de las paradas y de los servicios vigentes, con la regla
  // del paquete. Una ruta no pasa a en curso sin vehículo y conductor (§4.4-4).
  const cargada = cambiaronParadas ? await cargarRuta(tx, rutaId) : antes;
  if (!cargada) {
    throw new Error(`La ruta ${rutaId} desapareció dentro de la transacción`);
  }
  let estado = cargada.ruta.estado;
  for (let pasos = 0; pasos < 2; pasos += 1) {
    const siguiente = estadoQueCorresponde({ ...cargada.ruta, estado });
    if (siguiente === estado) {
      break;
    }
    if (siguiente === 'en_curso' && (ruta.vehicleId === null || conductorId === null)) {
      omitidas += 1;
      break;
    }
    estado = siguiente;
  }
  const cambiaEstado = estado !== ruta.status;
  if (cambiaEstado) {
    const ahora = new Date();
    const resueltas = cargada.paradas.map((p) => p.resolvedAt);
    const empezo = estado === 'en_curso' || estado === 'cerrada';
    // rls-allowlist: ruta tomada por id con FOR UPDATE en esta transacción
    await tx
      .update(rutas)
      .set({
        status: estado,
        startedAt: empezo
          ? (ruta.startedAt ??
            fechaMasTemprana(
              cargada.paradas.filter((p) => p.tipo === 'recogida').map((p) => p.resolvedAt),
            ) ??
            ahora)
          : ruta.startedAt,
        closedAt:
          estado === 'cerrada'
            ? (fechaMasTardia([...resueltas, ...cargada.servicios.map((s) => s.cancelledAt)]) ??
              ahora)
            : ruta.closedAt,
        cancelledAt:
          estado === 'cancelada'
            ? (fechaMasTardia(cargada.servicios.map((s) => s.cancelledAt)) ?? ahora)
            : ruta.cancelledAt,
        updatedAt: sql`now()`,
      })
      .where(eq(rutas.id, rutaId));
    await tx.insert(eventosRuta).values({
      rutaId,
      tipo: 'estado_cambiado',
      payload: { desde: ruta.status, hacia: estado, origen: ctx.origen },
      recordedByUserId: ctx.userId,
    });
  }

  if (omitidas > 0) {
    return {
      tipo: 'omitida',
      motivo: 'a la ruta le falta vehículo, conductor o una fecha para quedar al día',
    };
  }
  if (!cambiaEstado && !cambiaConductor && !cambiaronParadas) {
    return { tipo: 'sin_cambios', rutaId };
  }
  return { tipo: 'conciliada', rutaId, desde: ruta.status, hacia: estado };
}

/**
 * Deja la ruta de una asignación ya leída igual a ella. La fila debe venir
 * tomada con `FOR UPDATE` o recién escrita en la misma transacción.
 */
export async function sincronizarFila(
  tx: Tx,
  a: FilaParaRuta,
  ctx: ContextoSincronizacion,
): Promise<ResultadoSincronizacion> {
  const corresponde = rutaQueCorresponde(a);
  if (a.rutaId === null) {
    if (!corresponde.ok) {
      return { tipo: 'omitida', motivo: corresponde.motivo };
    }
    const rutaId = await crearRuta(tx, a, corresponde.plan, ctx);
    return { tipo: 'creada', rutaId, estado: corresponde.plan.estado };
  }
  return conciliarRuta(tx, a, a.rutaId, corresponde, ctx);
}

/**
 * Para quien acaba de escribir en una asignación: relee la fila dentro de la
 * transacción y deja su ruta igual. Si no se puede, lo registra y sigue: la
 * operación del usuario no falla por la ruta, y el job de relleno informa el
 * caso.
 */
export async function sincronizarRutaDeAsignacion(
  tx: Tx,
  opts: ContextoSincronizacion & { readonly asignacionId: string; readonly logger: Logger },
): Promise<ResultadoSincronizacion> {
  // rls-allowlist: asignación por id, ya autorizada y escrita por quien llama en esta transacción
  const [fila] = await tx
    .select(COLUMNAS_PARA_RUTA)
    .from(assignments)
    .where(eq(assignments.id, opts.asignacionId))
    .for('update');
  if (!fila) {
    throw new Error(`No existe la asignación ${opts.asignacionId}`);
  }
  const r = await sincronizarFila(tx, fila, { origen: opts.origen, userId: opts.userId });
  if (r.tipo === 'omitida') {
    opts.logger.warn(
      { assignmentId: opts.asignacionId, origen: opts.origen, motivo: r.motivo },
      'la ruta no quedó al día con su asignación',
    );
  }
  return r;
}
