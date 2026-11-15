import { type Presentacion, presentacionNivel } from '@booster-ai/certificate-generator';
import { componeConArrastre } from '@booster-ai/matching-algorithm';
import {
  type Aviso,
  type Ruta,
  type Tramo,
  type Violacion,
  avisosDeRuta,
  calcularTramos,
  declararConductor,
  declararConfiguracion,
  moverServicio,
  reordenarParadas,
  separarServicio,
} from '@booster-ai/route-planner';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type RutaRow,
  assignments,
  conductores,
  eventosRuta,
  metricasRuta,
  paradasRuta,
  rutas,
  tripMetrics,
  trips,
  users,
  vehicles,
} from '../db/schema.js';
import { condicionesConductorAsignable } from './asignar-conductor-a-assignment.js';
import { type RutaCargada, cargarRuta, configuracionDe } from './cargar-ruta.js';

/**
 * Operaciones de la API de rutas del transportista (plan de
 * ruta-parada-servicio, parte 5c): leer, agrupar, quitar, reordenar y
 * declarar vehículo, arrastre y conductor.
 *
 * Cada operación carga las rutas que toca con FOR UPDATE, pide el resultado a
 * `@booster-ai/route-planner` y persiste. Las reglas viven en el paquete.
 * Toda ruta se busca por id y empresa: la de otra empresa no existe.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const VIVAS = ['asignado', 'recogido'] as const;

export type MotivoUnidad =
  | 'no_es_de_la_flota'
  | 'no_esta_activa'
  | 'no_es_motriz'
  | 'no_es_arrastre'
  | 'no_compone_con_la_motriz';

export type FalloDeRuta =
  | { readonly ok: false; readonly code: 'ruta_not_found' | 'asignacion_not_found' }
  | {
      readonly ok: false;
      readonly code: 'ruta_invalida';
      readonly violaciones: readonly Violacion[];
    }
  | {
      readonly ok: false;
      readonly code: 'vehiculo_no_asignable';
      readonly unidad: 'vehiculo' | 'unidad_arrastre';
      readonly motivo: MotivoUnidad;
    }
  | { readonly ok: false; readonly code: 'conductor_no_asignable' };

export interface VistaDeRuta {
  readonly id: string;
  readonly estado: RutaRow['status'];
  readonly vehiculo: { readonly id: string; readonly patente: string } | null;
  readonly unidad_arrastre: { readonly id: string; readonly patente: string } | null;
  readonly conductor: { readonly id: string; readonly nombre: string } | null;
  readonly capacidad: { readonly kg: number; readonly m3: number | null } | null;
  readonly paradas: readonly {
    readonly id: string;
    readonly orden: number;
    readonly tipo: 'recogida' | 'entrega';
    readonly resuelta_en: string | null;
    readonly servicio: {
      readonly asignacion_id: string;
      readonly viaje_id: string;
      readonly codigo_seguimiento: string;
      readonly cancelado: boolean;
      readonly direccion: string;
      readonly ventana: { readonly desde: string | null; readonly hasta: string | null } | null;
      readonly peso_kg: number | null;
      readonly volumen_m3: number | null;
    };
  }[];
  readonly tramos: readonly {
    readonly desde: number;
    readonly hasta: number;
    readonly masa_kg: number;
    readonly volumen_m3: number | null;
    readonly vacio: boolean;
  }[];
  readonly avisos: readonly {
    readonly motivo: Aviso['motivo'];
    readonly tramo: number;
    readonly volumen_m3: number;
    readonly capacidad_m3: number;
  }[];
  /**
   * Huella consolidada §4. Solo en una ruta con más de una carga, y solo
   * cuando ya hay cifra. El total es de la ruta; cada servicio trae su parte.
   */
  readonly huella: {
    readonly es_estimacion: boolean;
    /** ADR-091: quién midió. No se deduce de que ya exista la cifra real. */
    readonly presentacion: Presentacion;
    readonly emisiones_kgco2e: string;
    readonly servicios: readonly {
      readonly viaje_id: string;
      readonly codigo_seguimiento: string;
      readonly participacion_pct: string;
      readonly emisiones_kgco2e: string | null;
    }[];
  } | null;
}

const tramoPublico = (t: Tramo) => ({
  desde: t.desde,
  hasta: t.hasta,
  masa_kg: t.masaKg,
  volumen_m3: t.volumenM3,
  vacio: t.vacio,
});

const rechazo = (violaciones: readonly Violacion[]): FalloDeRuta => ({
  ok: false,
  code: 'ruta_invalida',
  violaciones,
});

/** Carga y bloquea una ruta de la empresa; `null` si no existe o es de otra. */
async function rutaDeLaEmpresa(
  tx: Tx,
  empresaId: string,
  rutaId: string,
): Promise<RutaCargada | null> {
  const cargada = await cargarRuta(tx, rutaId, { paraActualizar: true });
  return cargada && cargada.fila.empresaId === empresaId ? cargada : null;
}

/** La ruta como la entrega la API: paradas con su servicio, tramos y avisos. */
async function vistaDe(tx: Tx, cargada: RutaCargada): Promise<VistaDeRuta> {
  const { fila, paradas, servicios, ruta } = cargada;
  const tripIds = servicios.map((s) => s.tripId);
  const viajes =
    tripIds.length === 0
      ? []
      : // rls-allowlist: viajes de los servicios de una ruta ya autorizada por empresa
        await tx
          .select({
            id: trips.id,
            trackingCode: trips.trackingCode,
            origen: trips.originAddressRaw,
            destino: trips.destinationAddressRaw,
            ventanaDesde: trips.pickupWindowStart,
            ventanaHasta: trips.pickupWindowEnd,
            pesoKg: trips.cargoWeightKg,
            volumenM3: trips.cargoVolumeM3,
          })
          .from(trips)
          .where(inArray(trips.id, tripIds));
  const idsUnidad = [fila.vehicleId, fila.unidadArrastreId].filter((id): id is string => !!id);
  const unidades =
    idsUnidad.length === 0
      ? []
      : // rls-allowlist: unidades declaradas en una ruta ya autorizada por empresa
        await tx
          .select({ id: vehicles.id, patente: vehicles.plate })
          .from(vehicles)
          .where(inArray(vehicles.id, idsUnidad));
  const [conductor] = fila.driverUserId
    ? // rls-allowlist: conductor declarado en una ruta ya autorizada por empresa
      await tx
        .select({ id: users.id, nombre: users.fullName })
        .from(users)
        .where(eq(users.id, fila.driverUserId))
        .limit(1)
    : [];
  const unidad = (id: string | null) => unidades.find((u) => u.id === id) ?? null;

  return {
    id: fila.id,
    estado: fila.status,
    vehiculo: unidad(fila.vehicleId),
    unidad_arrastre: unidad(fila.unidadArrastreId),
    conductor: conductor ?? null,
    capacidad: ruta.configuracion
      ? { kg: ruta.configuracion.capacidadKg, m3: ruta.configuracion.capacidadM3 }
      : null,
    paradas: paradas.flatMap((p, orden) => {
      const servicio = servicios.find((s) => s.tripId === p.tripId);
      const viaje = viajes.find((v) => v.id === p.tripId);
      if (!servicio || !viaje) {
        return [];
      }
      return [
        {
          id: p.id,
          orden,
          tipo: p.tipo,
          resuelta_en: p.resolvedAt?.toISOString() ?? null,
          servicio: {
            asignacion_id: servicio.asignacionId,
            viaje_id: viaje.id,
            codigo_seguimiento: viaje.trackingCode,
            cancelado: servicio.estado === 'cancelado',
            direccion: p.tipo === 'recogida' ? viaje.origen : viaje.destino,
            ventana:
              p.tipo === 'recogida'
                ? {
                    desde: viaje.ventanaDesde?.toISOString() ?? null,
                    hasta: viaje.ventanaHasta?.toISOString() ?? null,
                  }
                : null,
            peso_kg: viaje.pesoKg,
            volumen_m3: viaje.volumenM3,
          },
        },
      ];
    }),
    tramos: calcularTramos(ruta).map(tramoPublico),
    avisos: avisosDeRuta(ruta).map((a) => ({
      motivo: a.motivo,
      tramo: a.tramo,
      volumen_m3: a.volumenM3,
      capacidad_m3: a.capacidadM3,
    })),
    huella: await huellaDeRuta(tx, fila.id, viajes),
  };
}

/**
 * Total de la ruta y la parte de cada carga. Una ruta de una sola carga no
 * la trae: su huella sigue siendo la del viaje.
 */
async function huellaDeRuta(
  tx: Tx,
  rutaId: string,
  viajes: readonly { id: string; trackingCode: string }[],
): Promise<VistaDeRuta['huella']> {
  if (viajes.length < 2) {
    return null;
  }
  // rls-allowlist: metricas_ruta no tiene empresa_id; la ruta ya se autorizó por empresa
  const [total] = await tx
    .select({
      estimadas: metricasRuta.carbonEmissionsKgco2eEstimated,
      reales: metricasRuta.carbonEmissionsKgco2eActual,
      fuente: metricasRuta.routeDataSource,
      cobertura: metricasRuta.coveragePct,
      nivel: metricasRuta.certificationLevel,
    })
    .from(metricasRuta)
    .where(eq(metricasRuta.rutaId, rutaId))
    .limit(1);
  const emisiones = total?.reales ?? total?.estimadas ?? null;
  if (!total || emisiones == null) {
    return null;
  }
  const esEstimacion = total.reales == null;
  // rls-allowlist: partes de viajes de una ruta ya autorizada por empresa
  const partes = await tx
    .select({
      viajeId: tripMetrics.tripId,
      participacion: tripMetrics.participacion,
      estimadas: tripMetrics.carbonEmissionsKgco2eEstimated,
      reales: tripMetrics.carbonEmissionsKgco2eActual,
    })
    .from(tripMetrics)
    .where(
      inArray(
        tripMetrics.tripId,
        viajes.map((v) => v.id),
      ),
    );
  return {
    es_estimacion: esEstimacion,
    presentacion: presentacionNivel({
      ...(total.nivel ? { certificationLevel: total.nivel } : {}),
      ...(total.fuente ? { routeDataSource: total.fuente } : {}),
      ...(total.cobertura == null ? {} : { coveragePct: Number(total.cobertura) }),
    }).presentacion,
    emisiones_kgco2e: emisiones,
    servicios: viajes.flatMap((v) => {
      const parte = partes.find((p) => p.viajeId === v.id);
      if (!parte?.participacion) {
        return [];
      }
      return [
        {
          viaje_id: v.id,
          codigo_seguimiento: v.trackingCode,
          participacion_pct: parte.participacion,
          emisiones_kgco2e: esEstimacion ? parte.estimadas : parte.reales,
        },
      ];
    }),
  };
}

/** Relee la ruta ya escrita y arma su vista. */
async function vistaActual(tx: Tx, rutaId: string): Promise<VistaDeRuta> {
  const cargada = await cargarRuta(tx, rutaId);
  if (!cargada) {
    throw new Error(`La ruta ${rutaId} desapareció dentro de la transacción`);
  }
  return vistaDe(tx, cargada);
}

/**
 * Deja las paradas de una ruta como dice el paquete. Cada parada se reconoce
 * por su servicio y su tipo; la que viene de otra ruta cambia de ruta. El
 * orden único de la tabla es diferible, así que se puede reordenar dentro de
 * la transacción.
 */
async function guardarParadas(
  tx: Tx,
  rutaId: string,
  nueva: Ruta,
  conocidas: readonly { id: string; tripId: string; tipo: string; rutaId: string; orden: number }[],
): Promise<void> {
  for (const [orden, parada] of nueva.paradas.entries()) {
    const fila = conocidas.find((c) => c.tripId === parada.servicioId && c.tipo === parada.tipo);
    if (!fila) {
      throw new Error(`No hay parada de ${parada.tipo} para el servicio ${parada.servicioId}`);
    }
    if (fila.rutaId !== rutaId || fila.orden !== orden) {
      // rls-allowlist: parada por id, de rutas tomadas con FOR UPDATE y ya autorizadas por empresa
      await tx.update(paradasRuta).set({ rutaId, orden }).where(eq(paradasRuta.id, fila.id));
    }
  }
}

/** Persiste un cambio de estado que decidió el paquete, con su fecha y su evento. */
async function guardarEstado(
  tx: Tx,
  fila: RutaRow,
  estado: RutaRow['status'],
  userId: string,
): Promise<void> {
  if (estado === fila.status) {
    return;
  }
  // rls-allowlist: ruta tomada con FOR UPDATE y ya autorizada por empresa
  await tx
    .update(rutas)
    .set({
      status: estado,
      ...(estado === 'cancelada' ? { cancelledAt: sql`now()` } : {}),
      ...(estado === 'cerrada' ? { closedAt: sql`now()` } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(rutas.id, fila.id));
  await tx.insert(eventosRuta).values({
    rutaId: fila.id,
    tipo: 'estado_cambiado',
    payload: { desde: fila.status, hacia: estado, origen: 'api' },
    recordedByUserId: userId,
  });
}

export async function listarRutas(
  db: Db,
  opts: { readonly empresaId: string; readonly estados: readonly RutaRow['status'][] },
) {
  const filas = await db
    .select({
      id: rutas.id,
      estado: rutas.status,
      vehiculoId: rutas.vehicleId,
      arrastreId: rutas.unidadArrastreId,
      conductorId: rutas.driverUserId,
      conductorNombre: users.fullName,
      creadaEn: rutas.createdAt,
      servicios: sql<number>`(select count(*)::int from ${assignments} a where a.ruta_id = ${rutas.id})`,
      paradasPendientes: sql<number>`(select count(*)::int from ${paradasRuta} p where p.ruta_id = ${rutas.id} and p.resuelta_en is null)`,
    })
    .from(rutas)
    .leftJoin(users, eq(users.id, rutas.driverUserId))
    .where(and(eq(rutas.empresaId, opts.empresaId), inArray(rutas.status, [...opts.estados])))
    .orderBy(desc(rutas.createdAt), desc(rutas.id));
  const idsUnidad = [
    ...new Set(
      filas.flatMap((f) => [f.vehiculoId, f.arrastreId]).filter((id): id is string => !!id),
    ),
  ];
  const unidades =
    idsUnidad.length === 0
      ? []
      : await db
          .select({ id: vehicles.id, patente: vehicles.plate })
          .from(vehicles)
          .where(and(eq(vehicles.empresaId, opts.empresaId), inArray(vehicles.id, idsUnidad)));
  const unidad = (id: string | null) => unidades.find((u) => u.id === id) ?? null;
  return filas.map((f) => ({
    id: f.id,
    estado: f.estado,
    vehiculo: unidad(f.vehiculoId),
    unidad_arrastre: unidad(f.arrastreId),
    conductor:
      f.conductorId && f.conductorNombre ? { id: f.conductorId, nombre: f.conductorNombre } : null,
    servicios: f.servicios,
    paradas_pendientes: f.paradasPendientes,
    creada_en: f.creadaEn.toISOString(),
  }));
}

export async function verRuta(
  db: Db,
  opts: { readonly empresaId: string; readonly rutaId: string },
): Promise<{ ok: true; ruta: VistaDeRuta } | FalloDeRuta> {
  return db.transaction(async (tx) => {
    const cargada = await cargarRuta(tx, opts.rutaId);
    if (!cargada || cargada.fila.empresaId !== opts.empresaId) {
      return { ok: false, code: 'ruta_not_found' } as const;
    }
    return { ok: true, ruta: await vistaDe(tx, cargada) } as const;
  });
}

/** Agrupar (spec §4.2): mueve la asignación de su ruta a esta. */
export async function agruparServicio(
  db: Db,
  opts: {
    readonly empresaId: string;
    readonly rutaId: string;
    readonly asignacionId: string;
    readonly posicion: { readonly recogida: number; readonly entrega: number };
    readonly userId: string;
  },
): Promise<{ ok: true; ruta: VistaDeRuta; rutaOrigenId: string } | FalloDeRuta> {
  return db.transaction(async (tx) => {
    const [asignacion] = await tx
      .select({ id: assignments.id, tripId: assignments.tripId, rutaId: assignments.rutaId })
      .from(assignments)
      .where(and(eq(assignments.id, opts.asignacionId), eq(assignments.empresaId, opts.empresaId)))
      .for('update')
      .limit(1);
    if (!asignacion?.rutaId) {
      return { ok: false, code: 'asignacion_not_found' } as const;
    }
    if (asignacion.rutaId === opts.rutaId) {
      return rechazo([{ motivo: 'servicio_ya_en_la_ruta', servicioId: asignacion.tripId }]);
    }
    // Las dos rutas se bloquean siempre en el mismo orden: sin abrazos mortales.
    const [primera, segunda] = [asignacion.rutaId, opts.rutaId].sort();
    const cargadas = new Map<string, RutaCargada | null>();
    for (const id of [primera, segunda]) {
      if (id) {
        cargadas.set(id, await rutaDeLaEmpresa(tx, opts.empresaId, id));
      }
    }
    const destino = cargadas.get(opts.rutaId);
    const origen = cargadas.get(asignacion.rutaId);
    if (!destino) {
      return { ok: false, code: 'ruta_not_found' } as const;
    }
    if (!origen) {
      return { ok: false, code: 'asignacion_not_found' } as const;
    }

    const r = moverServicio(origen.ruta, destino.ruta, asignacion.tripId, opts.posicion);
    if (!r.ok) {
      return rechazo(r.violaciones);
    }
    const conocidas = [...origen.paradas, ...destino.paradas];
    await guardarParadas(tx, destino.fila.id, r.destino, conocidas);
    await guardarParadas(tx, origen.fila.id, r.origen, conocidas);
    // La asignación pasa a la ruta de destino y queda con su configuración.
    // rls-allowlist: asignación tomada por id y empresa con FOR UPDATE en esta transacción
    await tx
      .update(assignments)
      .set({
        rutaId: destino.fila.id,
        vehicleId: destino.fila.vehicleId,
        unidadArrastreId: destino.fila.unidadArrastreId,
        driverUserId: destino.fila.driverUserId,
        updatedAt: new Date(),
      })
      .where(eq(assignments.id, asignacion.id));
    await guardarEstado(tx, origen.fila, r.origen.estado, opts.userId);
    const servicio = { viaje_id: asignacion.tripId, asignacion_id: asignacion.id };
    await tx.insert(eventosRuta).values([
      {
        rutaId: origen.fila.id,
        tipo: 'servicio_quitado',
        payload: { ...servicio, ruta_destino_id: destino.fila.id, origen: 'api' },
        recordedByUserId: opts.userId,
      },
      {
        rutaId: destino.fila.id,
        tipo: 'servicio_agregado',
        payload: { ...servicio, ruta_origen_id: origen.fila.id, origen: 'api' },
        recordedByUserId: opts.userId,
      },
    ]);
    return {
      ok: true,
      ruta: await vistaActual(tx, destino.fila.id),
      rutaOrigenId: origen.fila.id,
    } as const;
  });
}

/** Quitar (spec §4.5, D4): el servicio vuelve a una ruta propia de dos paradas. */
export async function quitarServicioDeRuta(
  db: Db,
  opts: {
    readonly empresaId: string;
    readonly rutaId: string;
    readonly asignacionId: string;
    readonly userId: string;
  },
): Promise<{ ok: true; ruta: VistaDeRuta; rutaNuevaId: string } | FalloDeRuta> {
  return db.transaction(async (tx) => {
    const cargada = await rutaDeLaEmpresa(tx, opts.empresaId, opts.rutaId);
    if (!cargada) {
      return { ok: false, code: 'ruta_not_found' } as const;
    }
    const servicio = cargada.servicios.find((s) => s.asignacionId === opts.asignacionId);
    if (!servicio) {
      return { ok: false, code: 'asignacion_not_found' } as const;
    }
    const r = separarServicio(cargada.ruta, servicio.tripId);
    if (!r.ok) {
      return rechazo(r.violaciones);
    }
    const { fila } = cargada;
    const [nueva] = await tx
      .insert(rutas)
      .values({
        empresaId: fila.empresaId,
        vehicleId: fila.vehicleId,
        unidadArrastreId: fila.unidadArrastreId,
        driverUserId: fila.driverUserId,
        status: 'planificada',
      })
      .returning({ id: rutas.id });
    if (!nueva) {
      throw new Error('Insert ruta returned no row');
    }
    await guardarParadas(tx, nueva.id, r.propia, cargada.paradas);
    await guardarParadas(tx, fila.id, r.ruta, cargada.paradas);
    // rls-allowlist: asignación de la ruta tomada con FOR UPDATE y ya autorizada por empresa
    await tx
      .update(assignments)
      .set({
        rutaId: nueva.id,
        vehicleId: fila.vehicleId,
        unidadArrastreId: fila.unidadArrastreId,
        driverUserId: fila.driverUserId,
        updatedAt: new Date(),
      })
      .where(eq(assignments.id, servicio.asignacionId));
    await guardarEstado(tx, fila, r.ruta.estado, opts.userId);
    const payload = { viaje_id: servicio.tripId, asignacion_id: servicio.asignacionId };
    await tx.insert(eventosRuta).values([
      {
        rutaId: fila.id,
        tipo: 'servicio_quitado',
        payload: { ...payload, ruta_destino_id: nueva.id, origen: 'api' },
        recordedByUserId: opts.userId,
      },
      {
        rutaId: nueva.id,
        tipo: 'ruta_creada',
        payload: { ...payload, ruta_origen_id: fila.id, origen: 'api' },
        recordedByUserId: opts.userId,
      },
    ]);
    return { ok: true, ruta: await vistaActual(tx, fila.id), rutaNuevaId: nueva.id } as const;
  });
}

/** Reordenar: recibe todas las paradas de la ruta, por id, en el orden nuevo. */
export async function reordenarParadasDeRuta(
  db: Db,
  opts: {
    readonly empresaId: string;
    readonly rutaId: string;
    readonly paradaIds: readonly string[];
    readonly userId: string;
  },
): Promise<{ ok: true; ruta: VistaDeRuta } | FalloDeRuta> {
  return db.transaction(async (tx) => {
    const cargada = await rutaDeLaEmpresa(tx, opts.empresaId, opts.rutaId);
    if (!cargada) {
      return { ok: false, code: 'ruta_not_found' } as const;
    }
    const actuales = cargada.paradas.map((p) => p.id);
    // Un id que no es de la ruta queda en -1 y el paquete lo rechaza como orden inválido.
    const orden = opts.paradaIds.map((id) => actuales.indexOf(id));
    const r = reordenarParadas(cargada.ruta, orden);
    if (!r.ok) {
      return rechazo(r.violaciones);
    }
    await guardarParadas(tx, cargada.fila.id, r.ruta, cargada.paradas);
    await tx.insert(eventosRuta).values({
      rutaId: cargada.fila.id,
      tipo: 'paradas_reordenadas',
      payload: { antes: actuales, despues: [...opts.paradaIds], origen: 'api' },
      recordedByUserId: opts.userId,
    });
    return { ok: true, ruta: await vistaActual(tx, cargada.fila.id) } as const;
  });
}

const COLUMNAS_UNIDAD = {
  id: vehicles.id,
  empresaId: vehicles.empresaId,
  vehicleStatus: vehicles.vehicleStatus,
  unitCategory: vehicles.unitCategory,
  unitType: vehicles.unitType,
  bodyType: vehicles.bodyType,
  capacityKg: vehicles.capacityKg,
  capacityM3: vehicles.capacityM3,
} as const;

/**
 * Declarar vehículo, arrastre y conductor (D1 y D3). El vehículo y el
 * arrastre pasan por el paquete solo si cambian: con carga recogida no se
 * cambian. El conductor se releva también con la ruta en curso. Lo declarado
 * se copia a las asignaciones vivas de la ruta, que son su espejo.
 */
export async function declararConfiguracionDeRuta(
  db: Db,
  opts: {
    readonly empresaId: string;
    readonly rutaId: string;
    readonly vehiculoId: string;
    readonly unidadArrastreId: string | null;
    readonly conductorId: string | null;
    readonly userId: string;
  },
): Promise<{ ok: true; ruta: VistaDeRuta } | FalloDeRuta> {
  return db.transaction(async (tx) => {
    const cargada = await rutaDeLaEmpresa(tx, opts.empresaId, opts.rutaId);
    if (!cargada) {
      return { ok: false, code: 'ruta_not_found' } as const;
    }
    const { fila } = cargada;
    let ruta = cargada.ruta;

    const cambiaVehiculo =
      fila.vehicleId !== opts.vehiculoId || fila.unidadArrastreId !== opts.unidadArrastreId;
    if (cambiaVehiculo) {
      const ids = [opts.vehiculoId, opts.unidadArrastreId].filter((id): id is string => !!id);
      // rls-allowlist: se leen por id y se exige la empresa en el código, para decir por qué no sirven
      const unidades = await tx
        .select(COLUMNAS_UNIDAD)
        .from(vehicles)
        .where(inArray(vehicles.id, ids));
      const motriz = unidades.find((u) => u.id === opts.vehiculoId);
      const arrastre = unidades.find((u) => u.id === opts.unidadArrastreId);
      const fallo = (unidad: 'vehiculo' | 'unidad_arrastre', motivo: MotivoUnidad) =>
        ({ ok: false, code: 'vehiculo_no_asignable', unidad, motivo }) as const;
      if (!motriz || motriz.empresaId !== opts.empresaId) {
        return fallo('vehiculo', 'no_es_de_la_flota');
      }
      if (motriz.vehicleStatus !== 'activo') {
        return fallo('vehiculo', 'no_esta_activa');
      }
      if (motriz.unitCategory !== 'motriz') {
        return fallo('vehiculo', 'no_es_motriz');
      }
      if (opts.unidadArrastreId) {
        if (!arrastre || arrastre.empresaId !== opts.empresaId) {
          return fallo('unidad_arrastre', 'no_es_de_la_flota');
        }
        if (arrastre.vehicleStatus !== 'activo') {
          return fallo('unidad_arrastre', 'no_esta_activa');
        }
        if (arrastre.unitCategory !== 'arrastre') {
          return fallo('unidad_arrastre', 'no_es_arrastre');
        }
        if (!componeConArrastre(motriz.unitType, arrastre.unitType)) {
          return fallo('unidad_arrastre', 'no_compone_con_la_motriz');
        }
      }
      const configuracion = configuracionDe(motriz, arrastre);
      if (!configuracion) {
        return fallo('vehiculo', 'no_es_motriz');
      }
      const r = declararConfiguracion(ruta, configuracion);
      if (!r.ok) {
        return rechazo(r.violaciones);
      }
      ruta = r.ruta;
    }

    const cambiaConductor = fila.driverUserId !== opts.conductorId;
    if (cambiaConductor) {
      if (opts.conductorId) {
        const [conductor] = await tx
          .select({ id: conductores.id })
          .from(conductores)
          .where(condicionesConductorAsignable(opts.empresaId, opts.conductorId))
          .limit(1);
        if (!conductor) {
          return { ok: false, code: 'conductor_no_asignable' } as const;
        }
      }
      const r = declararConductor(ruta, opts.conductorId !== null);
      if (!r.ok) {
        return rechazo(r.violaciones);
      }
    }

    if (cambiaVehiculo || cambiaConductor) {
      const declarado = {
        vehicleId: opts.vehiculoId,
        unidadArrastreId: opts.unidadArrastreId,
        driverUserId: opts.conductorId,
      };
      // rls-allowlist: ruta tomada con FOR UPDATE y ya autorizada por empresa
      await tx
        .update(rutas)
        .set({ ...declarado, updatedAt: sql`now()` })
        .where(eq(rutas.id, fila.id));
      // rls-allowlist: asignaciones vivas de la ruta tomada con FOR UPDATE en esta transacción
      await tx
        .update(assignments)
        .set({ ...declarado, updatedAt: new Date() })
        .where(and(eq(assignments.rutaId, fila.id), inArray(assignments.status, [...VIVAS])));
      await tx.insert(eventosRuta).values({
        rutaId: fila.id,
        tipo: 'configuracion_declarada',
        payload: {
          vehiculo_id: opts.vehiculoId,
          unidad_arrastre_id: opts.unidadArrastreId,
          conductor_id: opts.conductorId,
          origen: 'api',
        },
        recordedByUserId: opts.userId,
      });
    }
    return { ok: true, ruta: await vistaActual(tx, fila.id) } as const;
  });
}
