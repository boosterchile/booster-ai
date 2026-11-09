import type { Logger } from '@booster-ai/logger';
import {
  CAMPOS_PROPONIBLES,
  type CambioPropuesto,
  type CambiosGuardados,
  type CampoPropuesto,
  type MotivoInvalidacion,
  cambioRespondidoPayloadSchema,
  cambioSolicitadoPayloadSchema,
  cambiosGuardadosSchema,
  cargaEditadaPayloadSchema,
} from '@booster-ai/shared-schemas';
import { aceptaSolicitudCambio, esEstadoViaje, esPreMatch } from '@booster-ai/trip-state-machine';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  assignments,
  liquidaciones,
  tripChangeRequests,
  tripEvents,
  trips,
  vehicles,
} from '../db/schema.js';
import {
  desglosePropuesto,
  leerComercialViaje,
  recalculoComercial,
} from './cambio-carga-comercial.js';
import {
  type ViajeEditable,
  cambiaComercial,
  camposQueCambian,
  columnasDesdeCambios,
  normalizarPropuesta,
  soloCampos,
  valoresActuales,
} from './cambio-carga-valores.js';
import type { DesgloseGenerador } from './cotizacion-comercial.js';

/**
 * Solicitudes de cambio de una carga asignada (editar-anular-cargas §6.3–6.5,
 * §6.9–6.10). El generador propone; el transportista acepta o rechaza.
 * Mientras la solicitud está pendiente el viaje conserva los datos originales
 * y la recogida queda bloqueada. Orden de locks en toda escritura: viaje,
 * asignación, solicitud (el mismo de cancelar-carga y asignar-conductor).
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AsignacionAviso {
  id: string;
  empresaId: string;
  driverUserId: string | null;
}

export interface SolicitudVista {
  id: string;
  estado: string;
  cambios: CambiosGuardados;
  valores_anteriores: CambiosGuardados;
  creado_en: string;
  respondido_en: string | null;
  razon_respuesta: string | null;
  motivo_invalidacion: string | null;
  cerrado_en: string | null;
}

const COLUMNAS_EDITABLES = {
  originAddressRaw: trips.originAddressRaw,
  originRegionCode: trips.originRegionCode,
  originComunaCode: trips.originComunaCode,
  originLatitude: trips.originLatitude,
  originLongitude: trips.originLongitude,
  destinationAddressRaw: trips.destinationAddressRaw,
  destinationRegionCode: trips.destinationRegionCode,
  destinationComunaCode: trips.destinationComunaCode,
  destinationLatitude: trips.destinationLatitude,
  destinationLongitude: trips.destinationLongitude,
  cargoType: trips.cargoType,
  cargoWeightKg: trips.cargoWeightKg,
  cargoVolumeM3: trips.cargoVolumeM3,
  cargoDescription: trips.cargoDescription,
  pickupWindowStart: trips.pickupWindowStart,
  pickupWindowEnd: trips.pickupWindowEnd,
  proposedPriceClp: trips.proposedPriceClp,
  modalidadCarga: trips.modalidadCarga,
} as const;

function vista(row: typeof tripChangeRequests.$inferSelect): SolicitudVista {
  return {
    id: row.id,
    estado: row.status,
    cambios: cambiosGuardadosSchema.parse(row.changes),
    valores_anteriores: cambiosGuardadosSchema.parse(row.previousValues),
    creado_en: row.createdAt.toISOString(),
    respondido_en: row.respondedAt?.toISOString() ?? null,
    razon_respuesta: row.responseReason,
    motivo_invalidacion: row.invalidationReason,
    cerrado_en: row.closedAt?.toISOString() ?? null,
  };
}

function camposDe(cambios: CambiosGuardados): CampoPropuesto[] {
  return CAMPOS_PROPONIBLES.filter((c) => cambios[c] !== undefined);
}

// ---------------------------------------------------------------------------
// Generador: crear
// ---------------------------------------------------------------------------

export type ResultadoCrearSolicitud =
  | {
      ok: true;
      solicitud: SolicitudVista;
      campos: CampoPropuesto[];
      asignacion: AsignacionAviso;
      /** Solo con un cambio comercial y tasa congelada; lo ve solo el generador. */
      desglosePropuesto: DesgloseGenerador | null;
    }
  | { ok: false; code: 'trip_not_found' }
  | { ok: false; code: 'contrato_programado_no_habilitado' }
  | { ok: false; code: 'trip_not_matched' }
  | { ok: false; code: 'trip_not_editable'; currentStatus: string }
  | { ok: false; code: 'sin_cambios' }
  | { ok: false; code: 'cambio_pendiente_existente'; solicitudId: string };

export async function crearSolicitudCambio(
  deps: { db: Db; logger: Logger },
  opts: { tripId: string; empresaId: string; userId: string; cambios: CambioPropuesto },
): Promise<ResultadoCrearSolicitud> {
  const { db, logger } = deps;
  const { tripId, empresaId, userId } = opts;
  return await db.transaction(async (tx) => {
    const [viaje] = await tx
      .select({ status: trips.status, ...COLUMNAS_EDITABLES })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)))
      .for('update')
      .limit(1);
    if (!viaje) {
      return { ok: false, code: 'trip_not_found' } as const;
    }
    const estado = viaje.status;
    if (esEstadoViaje(estado) && esPreMatch(estado)) {
      return { ok: false, code: 'trip_not_matched' } as const;
    }
    if (!esEstadoViaje(estado) || !aceptaSolicitudCambio(estado)) {
      return { ok: false, code: 'trip_not_editable', currentStatus: estado } as const;
    }
    // rls-allowlist: asignación del viaje ya validado contra la empresa generadora (empresaId).
    const [asignacion] = await tx
      .select({
        id: assignments.id,
        empresaId: assignments.empresaId,
        driverUserId: assignments.driverUserId,
      })
      .from(assignments)
      .where(and(eq(assignments.tripId, tripId), eq(assignments.status, 'asignado')))
      .for('update')
      .limit(1);
    if (!asignacion) {
      return { ok: false, code: 'trip_not_editable', currentStatus: estado } as const;
    }

    const actuales = valoresActuales(viaje satisfies ViajeEditable);
    const propuesta = normalizarPropuesta(opts.cambios);
    const campos = camposQueCambian(actuales, propuesta);
    if (campos.length === 0) {
      return { ok: false, code: 'sin_cambios' } as const;
    }

    let desglose: DesgloseGenerador | null = null;
    if (cambiaComercial(campos)) {
      const comercial = await leerComercialViaje(tx, tripId);
      // ADR-079 §2: `programada` exige contrato programado habilitado.
      const chequeo = recalculoComercial(comercial, soloCampos(propuesta, campos), 0);
      if (!chequeo.ok) {
        return { ok: false, code: chequeo.code } as const;
      }
      desglose = desglosePropuesto(comercial, soloCampos(propuesta, campos));
    }

    // rls-allowlist: solicitudes del viaje ya validado contra la empresa generadora (empresaId).
    const [pendiente] = await tx
      .select({ id: tripChangeRequests.id })
      .from(tripChangeRequests)
      .where(and(eq(tripChangeRequests.tripId, tripId), eq(tripChangeRequests.status, 'pendiente')))
      .limit(1);
    if (pendiente) {
      return { ok: false, code: 'cambio_pendiente_existente', solicitudId: pendiente.id } as const;
    }

    const [fila] = await tx
      .insert(tripChangeRequests)
      .values({
        tripId,
        assignmentId: asignacion.id,
        requestedByUserId: userId,
        changes: soloCampos(propuesta, campos),
        previousValues: soloCampos(actuales, campos),
      })
      .returning();
    if (!fila) {
      throw new Error(`no se pudo crear la solicitud de cambio del viaje ${tripId}`);
    }
    await tx.insert(tripEvents).values({
      tripId,
      assignmentId: asignacion.id,
      eventType: 'cambio_solicitado',
      source: 'web',
      recordedByUserId: userId,
      payload: cambioSolicitadoPayloadSchema.parse({ solicitud_id: fila.id, campos }),
    });
    logger.info({ tripId, solicitudId: fila.id, campos }, 'solicitud de cambio creada');
    return {
      ok: true,
      solicitud: vista(fila),
      campos,
      asignacion,
      desglosePropuesto: desglose,
    } as const;
  });
}

// ---------------------------------------------------------------------------
// Generador: retirar y listar
// ---------------------------------------------------------------------------

export type ResultadoRetirarSolicitud =
  | { ok: true; asignacion: AsignacionAviso }
  | { ok: false; code: 'trip_not_found' }
  | { ok: false; code: 'solicitud_no_vigente' };

export async function retirarSolicitudCambio(
  deps: { db: Db; logger: Logger },
  opts: { tripId: string; empresaId: string; userId: string; solicitudId: string },
): Promise<ResultadoRetirarSolicitud> {
  const { db, logger } = deps;
  const { tripId, empresaId, userId, solicitudId } = opts;
  return await db.transaction(async (tx) => {
    const [viaje] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)))
      .for('update')
      .limit(1);
    if (!viaje) {
      return { ok: false, code: 'trip_not_found' } as const;
    }
    const now = new Date();
    // rls-allowlist: solicitud del viaje ya validado contra la empresa generadora (empresaId).
    const [cerrada] = await tx
      .update(tripChangeRequests)
      .set({ status: 'retirada', closedAt: now })
      .where(
        and(
          eq(tripChangeRequests.id, solicitudId),
          eq(tripChangeRequests.tripId, tripId),
          eq(tripChangeRequests.status, 'pendiente'),
        ),
      )
      .returning({ assignmentId: tripChangeRequests.assignmentId });
    if (!cerrada) {
      return { ok: false, code: 'solicitud_no_vigente' } as const;
    }
    await tx.insert(tripEvents).values({
      tripId,
      assignmentId: cerrada.assignmentId,
      eventType: 'cambio_respondido',
      source: 'web',
      recordedByUserId: userId,
      payload: cambioRespondidoPayloadSchema.parse({
        solicitud_id: solicitudId,
        resultado: 'retirado',
      }),
    });
    // rls-allowlist: asignación del viaje ya validado contra la empresa generadora (empresaId).
    const [asignacion] = await tx
      .select({
        id: assignments.id,
        empresaId: assignments.empresaId,
        driverUserId: assignments.driverUserId,
      })
      .from(assignments)
      .where(eq(assignments.id, cerrada.assignmentId))
      .limit(1);
    if (!asignacion) {
      throw new Error(`la solicitud ${solicitudId} apunta a una asignación inexistente`);
    }
    logger.info({ tripId, solicitudId }, 'solicitud de cambio retirada');
    return { ok: true, asignacion } as const;
  });
}

/** Historial de solicitudes del viaje, la más reciente primero. */
export async function listarSolicitudesCambio(
  deps: { db: Db },
  opts: { tripId: string; empresaId: string },
): Promise<SolicitudVista[] | null> {
  const [viaje] = await deps.db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, opts.tripId), eq(trips.generadorCargaEmpresaId, opts.empresaId)))
    .limit(1);
  if (!viaje) {
    return null;
  }
  // rls-allowlist: solicitudes del viaje ya validado contra la empresa generadora (empresaId).
  const filas = await deps.db
    .select()
    .from(tripChangeRequests)
    .where(eq(tripChangeRequests.tripId, opts.tripId))
    .orderBy(desc(tripChangeRequests.createdAt));
  return filas.map(vista);
}

/** La solicitud pendiente del viaje, si hay. Para el detalle y el bloqueo. */
export async function solicitudPendienteDeViaje(
  db: Db | Tx,
  tripId: string,
): Promise<SolicitudVista | null> {
  // rls-allowlist: el llamador ya validó el viaje contra su empresa.
  const [fila] = await db
    .select()
    .from(tripChangeRequests)
    .where(and(eq(tripChangeRequests.tripId, tripId), eq(tripChangeRequests.status, 'pendiente')))
    .limit(1);
  return fila ? vista(fila) : null;
}

// ---------------------------------------------------------------------------
// Invalidación (cancelación del viaje)
// ---------------------------------------------------------------------------

/**
 * Cierra como `invalidada` la solicitud pendiente del viaje, con su evento.
 * Corre dentro de la tx del llamador, que ya tiene el lock del viaje.
 */
export async function invalidarSolicitudPendiente(
  tx: Tx,
  opts: { tripId: string; userId: string | null; motivo: MotivoInvalidacion },
): Promise<string | null> {
  // rls-allowlist: el llamador tiene el lock del viaje ya validado contra su empresa.
  const [cerrada] = await tx
    .update(tripChangeRequests)
    .set({ status: 'invalidada', invalidationReason: opts.motivo, closedAt: new Date() })
    .where(
      and(eq(tripChangeRequests.tripId, opts.tripId), eq(tripChangeRequests.status, 'pendiente')),
    )
    .returning({ id: tripChangeRequests.id, assignmentId: tripChangeRequests.assignmentId });
  if (!cerrada) {
    return null;
  }
  await tx.insert(tripEvents).values({
    tripId: opts.tripId,
    assignmentId: cerrada.assignmentId,
    eventType: 'cambio_respondido',
    source: opts.userId ? 'web' : 'sistema',
    recordedByUserId: opts.userId,
    payload: cambioRespondidoPayloadSchema.parse({
      solicitud_id: cerrada.id,
      resultado: 'invalidado',
      motivo_invalidacion: opts.motivo,
    }),
  });
  return cerrada.id;
}

// ---------------------------------------------------------------------------
// Transportista: aceptar y rechazar
// ---------------------------------------------------------------------------

interface ContextoRespuesta {
  viaje: { id: string; status: string; trackingCode: string; createdByUserId: string | null };
  asignacion: AsignacionAviso & {
    status: string;
    vehicleId: string | null;
    agreedPriceClp: number;
  };
  solicitud: typeof tripChangeRequests.$inferSelect;
}

type FalloContexto =
  | { ok: false; code: 'assignment_not_found' }
  | { ok: false; code: 'solicitud_not_found' }
  | { ok: false; code: 'solicitud_no_vigente' };

/** Locks en orden viaje → asignación → solicitud, con la asignación de `empresaId`. */
async function bloquearContexto(
  tx: Tx,
  opts: { assignmentId: string; empresaId: string; solicitudId: string },
): Promise<{ ok: true; ctx: ContextoRespuesta } | FalloContexto> {
  // rls-allowlist: el viaje se busca por la asignación, cuya empresa se valida abajo.
  const [viaje] = await tx
    .select({
      id: trips.id,
      status: trips.status,
      trackingCode: trips.trackingCode,
      createdByUserId: trips.createdByUserId,
    })
    .from(trips)
    .where(
      eq(
        trips.id,
        sql`(select ${assignments.tripId} from ${assignments} where ${assignments.id} = ${opts.assignmentId})`,
      ),
    )
    .for('update')
    .limit(1);
  const [asignacion] = await tx
    .select({
      id: assignments.id,
      empresaId: assignments.empresaId,
      driverUserId: assignments.driverUserId,
      status: assignments.status,
      vehicleId: assignments.vehicleId,
      agreedPriceClp: assignments.agreedPriceClp,
    })
    .from(assignments)
    .where(and(eq(assignments.id, opts.assignmentId), eq(assignments.empresaId, opts.empresaId)))
    .for('update')
    .limit(1);
  if (!viaje || !asignacion) {
    return { ok: false, code: 'assignment_not_found' };
  }
  // rls-allowlist: solicitud de la asignación ya validada contra la empresa transportista (empresaId).
  const [solicitud] = await tx
    .select()
    .from(tripChangeRequests)
    .where(
      and(
        eq(tripChangeRequests.id, opts.solicitudId),
        eq(tripChangeRequests.assignmentId, opts.assignmentId),
      ),
    )
    .for('update')
    .limit(1);
  if (!solicitud) {
    return { ok: false, code: 'solicitud_not_found' };
  }
  if (solicitud.status !== 'pendiente') {
    return { ok: false, code: 'solicitud_no_vigente' };
  }
  return { ok: true, ctx: { viaje, asignacion, solicitud } };
}

async function cerrarComoInvalidada(
  tx: Tx,
  ctx: ContextoRespuesta,
  userId: string,
  motivo: MotivoInvalidacion,
): Promise<void> {
  // rls-allowlist: solicitud bloqueada en bloquearContexto, validada contra la empresa.
  await tx
    .update(tripChangeRequests)
    .set({ status: 'invalidada', invalidationReason: motivo, closedAt: new Date() })
    .where(
      and(eq(tripChangeRequests.id, ctx.solicitud.id), eq(tripChangeRequests.status, 'pendiente')),
    );
  await tx.insert(tripEvents).values({
    tripId: ctx.viaje.id,
    assignmentId: ctx.asignacion.id,
    eventType: 'cambio_respondido',
    source: 'web',
    recordedByUserId: userId,
    payload: cambioRespondidoPayloadSchema.parse({
      solicitud_id: ctx.solicitud.id,
      resultado: 'invalidado',
      motivo_invalidacion: motivo,
    }),
  });
}

export interface AvisoRespuesta {
  tripId: string;
  trackingCode: string;
  generadorUserId: string | null;
  asignacion: AsignacionAviso;
}

export type ResultadoAceptarSolicitud =
  | {
      ok: true;
      campos: CampoPropuesto[];
      aviso: AvisoRespuesta;
      vehicleId: string | null;
      /** Cambió el origen sin coordenadas: hay que geocodificarlo post-commit. */
      origenSinCoordenadas: { originAddress: string; destinationAddress: string } | null;
    }
  | FalloContexto
  | { ok: false; code: 'solicitud_invalidada'; motivo: MotivoInvalidacion }
  | { ok: false; code: 'excede_capacidad_vehiculo'; capacidadKg: number; pesoKg: number }
  | { ok: false; code: 'contrato_programado_no_habilitado' };

export async function aceptarSolicitudCambio(
  deps: { db: Db; logger: Logger },
  opts: { assignmentId: string; empresaId: string; userId: string; solicitudId: string },
): Promise<ResultadoAceptarSolicitud> {
  const { db, logger } = deps;
  return await db.transaction(async (tx) => {
    const bloqueo = await bloquearContexto(tx, opts);
    if (!bloqueo.ok) {
      return bloqueo;
    }
    const { ctx } = bloqueo;
    const cambios = cambiosGuardadosSchema.parse(ctx.solicitud.changes);
    const anteriores = cambiosGuardadosSchema.parse(ctx.solicitud.previousValues);
    const campos = camposDe(cambios);

    // Defensivo: con la recogida y la entrega bloqueadas no debería pasar.
    // rls-allowlist: liquidación de la asignación ya validada contra la empresa transportista.
    const [liquidacion] = await tx
      .select({ id: liquidaciones.id })
      .from(liquidaciones)
      .where(eq(liquidaciones.asignacionId, ctx.asignacion.id))
      .limit(1);
    if (ctx.viaje.status !== 'asignado' || ctx.asignacion.status !== 'asignado' || liquidacion) {
      await cerrarComoInvalidada(tx, ctx, opts.userId, 'viaje_no_asignado');
      return { ok: false, code: 'solicitud_invalidada', motivo: 'viaje_no_asignado' } as const;
    }

    const [viajeActual] = await tx
      .select(COLUMNAS_EDITABLES)
      .from(trips)
      .where(eq(trips.id, ctx.viaje.id))
      .limit(1);
    if (!viajeActual) {
      throw new Error(`viaje ${ctx.viaje.id} desapareció dentro de la transacción`);
    }
    const actuales = valoresActuales(viajeActual);
    if (camposQueCambian(soloCampos(actuales, campos), anteriores).length > 0) {
      await cerrarComoInvalidada(tx, ctx, opts.userId, 'datos_cambiaron');
      return { ok: false, code: 'solicitud_invalidada', motivo: 'datos_cambiaron' } as const;
    }

    if (typeof cambios.weight_kg === 'number' && ctx.asignacion.vehicleId) {
      // rls-allowlist: vehículo de la asignación ya validada contra la empresa transportista.
      const [vehiculo] = await tx
        .select({ capacityKg: vehicles.capacityKg })
        .from(vehicles)
        .where(eq(vehicles.id, ctx.asignacion.vehicleId))
        .limit(1);
      if (vehiculo && cambios.weight_kg > vehiculo.capacityKg) {
        // La solicitud sigue pendiente: el transportista cambia de vehículo o rechaza (§12-P9).
        return {
          ok: false,
          code: 'excede_capacidad_vehiculo',
          capacidadKg: vehiculo.capacityKg,
          pesoKg: cambios.weight_kg,
        } as const;
      }
    }

    // Precio y modalidad (§7): se re-valida el contrato programado, por si se
    // desactivó entre la solicitud y la respuesta, y se recalcula en esta tx.
    let comercial: Extract<ReturnType<typeof recalculoComercial>, { ok: true }> | null = null;
    if (cambiaComercial(campos)) {
      const rec = recalculoComercial(
        await leerComercialViaje(tx, ctx.viaje.id),
        cambios,
        ctx.asignacion.agreedPriceClp,
      );
      if (!rec.ok) {
        return { ok: false, code: rec.code } as const;
      }
      comercial = rec;
    }

    const now = new Date();
    await tx
      .update(trips)
      .set({ ...columnasDesdeCambios(cambios), ...comercial?.viaje, updatedAt: now })
      .where(eq(trips.id, ctx.viaje.id));
    const asignacionSet = {
      // La ruta eco sugerida era para el recorrido anterior.
      ...(cambios.origin || cambios.destination ? { ecoRoutePolylineEncoded: null } : {}),
      // La liquidación lee el precio acordado de la asignación.
      ...comercial?.asignacion,
    };
    if (Object.keys(asignacionSet).length > 0) {
      // rls-allowlist: asignación bloqueada en bloquearContexto, validada contra la empresa.
      await tx
        .update(assignments)
        .set({ ...asignacionSet, updatedAt: now })
        .where(eq(assignments.id, ctx.asignacion.id));
    }
    // rls-allowlist: solicitud bloqueada en bloquearContexto, validada contra la empresa.
    const aceptadas = await tx
      .update(tripChangeRequests)
      .set({
        status: 'aceptada',
        respondedByUserId: opts.userId,
        respondedAt: now,
        closedAt: now,
      })
      .where(
        and(
          eq(tripChangeRequests.id, ctx.solicitud.id),
          eq(tripChangeRequests.status, 'pendiente'),
        ),
      )
      .returning({ id: tripChangeRequests.id });
    if (aceptadas.length === 0) {
      throw new Error(`la solicitud ${ctx.solicitud.id} dejó de estar pendiente bajo lock`);
    }
    await tx.insert(tripEvents).values([
      {
        tripId: ctx.viaje.id,
        assignmentId: ctx.asignacion.id,
        eventType: 'cambio_respondido' as const,
        source: 'web' as const,
        recordedByUserId: opts.userId,
        payload: cambioRespondidoPayloadSchema.parse({
          solicitud_id: ctx.solicitud.id,
          resultado: 'aceptado',
        }),
      },
      {
        tripId: ctx.viaje.id,
        assignmentId: ctx.asignacion.id,
        eventType: 'carga_editada' as const,
        source: 'web' as const,
        recordedByUserId: opts.userId,
        payload: cargaEditadaPayloadSchema.parse({
          modo: 'cambio_aceptado',
          solicitud_id: ctx.solicitud.id,
          campos,
          antes: anteriores,
          despues: cambios,
          ...(comercial ? { comercial: comercial.bloque } : {}),
        }),
      },
    ]);
    logger.info(
      {
        tripId: ctx.viaje.id,
        assignmentId: ctx.asignacion.id,
        solicitudId: ctx.solicitud.id,
        campos,
      },
      'solicitud de cambio aceptada',
    );
    const origenSinCoordenadas =
      cambios.origin && cambios.origin.latitude == null
        ? {
            originAddress: cambios.origin.address_raw,
            destinationAddress:
              cambios.destination?.address_raw ?? viajeActual.destinationAddressRaw,
          }
        : null;
    return {
      ok: true,
      campos,
      vehicleId: ctx.asignacion.vehicleId,
      origenSinCoordenadas,
      aviso: {
        tripId: ctx.viaje.id,
        trackingCode: ctx.viaje.trackingCode,
        generadorUserId: ctx.viaje.createdByUserId,
        asignacion: ctx.asignacion,
      },
    } as const;
  });
}

export type ResultadoRechazarSolicitud = { ok: true; aviso: AvisoRespuesta } | FalloContexto;

export async function rechazarSolicitudCambio(
  deps: { db: Db; logger: Logger },
  opts: {
    assignmentId: string;
    empresaId: string;
    userId: string;
    solicitudId: string;
    reason?: string;
  },
): Promise<ResultadoRechazarSolicitud> {
  const { db, logger } = deps;
  const motivo = opts.reason?.trim() ? opts.reason.trim() : null;
  return await db.transaction(async (tx) => {
    const bloqueo = await bloquearContexto(tx, opts);
    if (!bloqueo.ok) {
      return bloqueo;
    }
    const { ctx } = bloqueo;
    const now = new Date();
    // rls-allowlist: solicitud bloqueada en bloquearContexto, validada contra la empresa.
    await tx
      .update(tripChangeRequests)
      .set({
        status: 'rechazada',
        respondedByUserId: opts.userId,
        respondedAt: now,
        responseReason: motivo,
        closedAt: now,
      })
      .where(
        and(
          eq(tripChangeRequests.id, ctx.solicitud.id),
          eq(tripChangeRequests.status, 'pendiente'),
        ),
      );
    await tx.insert(tripEvents).values({
      tripId: ctx.viaje.id,
      assignmentId: ctx.asignacion.id,
      eventType: 'cambio_respondido',
      source: 'web',
      recordedByUserId: opts.userId,
      payload: cambioRespondidoPayloadSchema.parse({
        solicitud_id: ctx.solicitud.id,
        resultado: 'rechazado',
      }),
    });
    logger.info(
      { tripId: ctx.viaje.id, assignmentId: ctx.asignacion.id, solicitudId: ctx.solicitud.id },
      'solicitud de cambio rechazada',
    );
    return {
      ok: true,
      aviso: {
        tripId: ctx.viaje.id,
        trackingCode: ctx.viaje.trackingCode,
        generadorUserId: ctx.viaje.createdByUserId,
        asignacion: ctx.asignacion,
      },
    } as const;
  });
}
