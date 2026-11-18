import {
  type UnidadDeFlota,
  capacidadDeConfiguracion,
  componeConArrastre,
} from '@booster-ai/matching-algorithm';
import { type Configuracion, type Ruta, validarRuta } from '@booster-ai/route-planner';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type AssignmentRow,
  type ParadaRutaRow,
  type RutaRow,
  assignments,
  paradasRuta,
  rutas,
  trips,
  vehicles,
} from '../db/schema.js';

/**
 * Carga una ruta de la base y la arma como la entiende
 * `@booster-ai/route-planner` (plan de ruta-parada-servicio, parte 5b). Los
 * services cargan con esto, llaman al paquete y persisten: no llevan reglas
 * de la ruta dentro (spec §6).
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Un servicio de la ruta: su asignación y lo que el paquete necesita del viaje. */
export interface ServicioCargado {
  readonly asignacionId: string;
  readonly tripId: string;
  readonly estado: AssignmentRow['status'];
  readonly pickedUpAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly cancelledAt: Date | null;
}

export interface RutaCargada {
  readonly fila: RutaRow;
  /** Las paradas en el orden de la ruta: el índice es la posición del paquete. */
  readonly paradas: readonly ParadaRutaRow[];
  /** Los servicios en el orden de su parada de recogida. */
  readonly servicios: readonly ServicioCargado[];
  readonly ruta: Ruta;
}

type FilaVehiculo = UnidadDeFlota;

const COLUMNAS_UNIDAD = {
  id: vehicles.id,
  unitCategory: vehicles.unitCategory,
  unitType: vehicles.unitType,
  bodyType: vehicles.bodyType,
  capacityKg: vehicles.capacityKg,
  capacityM3: vehicles.capacityM3,
} as const;

/**
 * La configuración de la ruta desde sus unidades. Sin motriz declarada no hay
 * configuración. Un arrastre que no compone con la motriz no suma capacidad:
 * la ruta se mide con la motriz sola.
 */
export function configuracionDe(
  motriz: FilaVehiculo | undefined,
  arrastre: FilaVehiculo | undefined,
): Configuracion | null {
  if (!motriz || motriz.unitCategory !== 'motriz') {
    return null;
  }
  const compone =
    arrastre !== undefined &&
    arrastre.unitCategory === 'arrastre' &&
    componeConArrastre(motriz.unitType, arrastre.unitType);
  return capacidadDeConfiguracion(motriz, compone ? arrastre : null);
}

/**
 * La ruta completa, o `null` si no existe. Con `paraActualizar`, toma la fila
 * de la ruta con FOR UPDATE: quien va a escribir en ella la bloquea primero.
 */
export async function cargarRuta(
  tx: Tx,
  rutaId: string,
  opts: { readonly paraActualizar?: boolean } = {},
): Promise<RutaCargada | null> {
  // rls-allowlist: ruta por id; quien llama ya autorizó la empresa o viene de una asignación autorizada
  const consulta = tx.select().from(rutas).where(eq(rutas.id, rutaId));
  const [fila] = opts.paraActualizar ? await consulta.for('update') : await consulta;
  if (!fila) {
    return null;
  }
  // rls-allowlist: paradas de la ruta recién tomada por id
  const paradas = await tx
    .select()
    .from(paradasRuta)
    .where(eq(paradasRuta.rutaId, rutaId))
    .orderBy(asc(paradasRuta.orden));
  // rls-allowlist: asignaciones de la ruta recién tomada por id
  const filasServicio = await tx
    .select({
      asignacionId: assignments.id,
      tripId: assignments.tripId,
      empresaId: assignments.empresaId,
      estado: assignments.status,
      pickedUpAt: assignments.pickedUpAt,
      deliveredAt: assignments.deliveredAt,
      cancelledAt: assignments.cancelledAt,
      tipoCarga: trips.cargoType,
      pesoKg: trips.cargoWeightKg,
      volumenM3: trips.cargoVolumeM3,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(eq(assignments.rutaId, rutaId));
  const idsUnidad = [fila.vehicleId, fila.unidadArrastreId].filter((id): id is string => !!id);
  const unidades =
    idsUnidad.length === 0
      ? []
      : // rls-allowlist: unidades declaradas en la ruta recién tomada por id
        await tx.select(COLUMNAS_UNIDAD).from(vehicles).where(inArray(vehicles.id, idsUnidad));

  const posicionDeRecogida = (tripId: string) => {
    const i = paradas.findIndex((p) => p.tripId === tripId && p.tipo === 'recogida');
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordenadas = [...filasServicio].sort(
    (a, b) =>
      posicionDeRecogida(a.tripId) - posicionDeRecogida(b.tripId) ||
      a.asignacionId.localeCompare(b.asignacionId),
  );
  return {
    fila,
    paradas,
    servicios: ordenadas.map((s) => ({
      asignacionId: s.asignacionId,
      tripId: s.tripId,
      estado: s.estado,
      pickedUpAt: s.pickedUpAt,
      deliveredAt: s.deliveredAt,
      cancelledAt: s.cancelledAt,
    })),
    ruta: {
      empresaId: fila.empresaId,
      estado: fila.status,
      configuracion: configuracionDe(
        unidades.find((u) => u.id === fila.vehicleId),
        unidades.find((u) => u.id === fila.unidadArrastreId),
      ),
      tieneConductor: fila.driverUserId !== null,
      paradas: paradas.map((p) => ({
        servicioId: p.tripId,
        tipo: p.tipo,
        resuelta: p.resolvedAt !== null,
      })),
      servicios: ordenadas.map((s) => ({
        servicioId: s.tripId,
        empresaId: s.empresaId,
        tipoCarga: s.tipoCarga,
        pesoKg: s.pesoKg,
        volumenM3: s.volumenM3,
        cancelado: s.estado === 'cancelado',
      })),
    },
  };
}

/**
 * ¿El peso nuevo de un servicio cabe en su ruta? Devuelve el tramo más
 * cargado que supera la capacidad, o `null` si cabe.
 *
 * Solo mide rutas con más de un servicio vigente. Un servicio que viaja solo
 * se mide contra su camión, como siempre: quien llama ya lo hace.
 */
export async function pesoQueNoCabeEnLaRuta(
  tx: Tx,
  opts: { readonly rutaId: string; readonly tripId: string; readonly pesoKg: number },
): Promise<{ readonly capacidadKg: number; readonly masaKg: number } | null> {
  const cargada = await cargarRuta(tx, opts.rutaId);
  if (!cargada || cargada.ruta.servicios.filter((s) => !s.cancelado).length < 2) {
    return null;
  }
  const conPesoNuevo: Ruta = {
    ...cargada.ruta,
    servicios: cargada.ruta.servicios.map((s) =>
      s.servicioId === opts.tripId ? { ...s, pesoKg: opts.pesoKg } : s,
    ),
  };
  let peor: { capacidadKg: number; masaKg: number } | null = null;
  for (const v of validarRuta(conPesoNuevo)) {
    if (
      v.motivo === 'capacidad_peso_excedida' &&
      v.masaKg !== undefined &&
      v.capacidadKg !== undefined &&
      (peor === null || v.masaKg > peor.masaKg)
    ) {
      peor = { capacidadKg: v.capacidadKg, masaKg: v.masaKg };
    }
  }
  return peor;
}
