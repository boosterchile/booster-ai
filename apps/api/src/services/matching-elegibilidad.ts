import {
  type CandidataPorCarga,
  type UnidadDeFlota,
  candidatasPorCarga,
} from '@booster-ai/matching-algorithm';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type TripRow, vehicles } from '../db/schema.js';

/**
 * Elegibilidad por carga dentro del matching (ADR-090, spec
 * matching-desde-la-carga parte 2). La regla es pura y vive en
 * `@booster-ai/matching-algorithm`; aquí solo se carga la flota.
 *
 * - `vigente`: el matching decide como hasta ahora (un vehículo activo con
 *   capacidad para el peso) y esto no corre.
 * - `sombra`: decide el vigente; la elegibilidad por carga se calcula al lado
 *   y se registra la diferencia. No cambia ninguna oferta.
 * - `activa`: decide la elegibilidad por carga.
 */
export const MODOS_ELEGIBILIDAD = ['vigente', 'sombra', 'activa'] as const;
export type ModoElegibilidad = (typeof MODOS_ELEGIBILIDAD)[number];

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Las candidatas de un viaje según la elegibilidad por carga, entre las
 * empresas que ya pasaron los filtros de zona y de transportista activa.
 * Conserva el orden de `empresaIds`.
 */
export async function cargarCandidatasPorCarga(
  tx: Tx,
  opts: {
    readonly trip: Pick<TripRow, 'cargoType' | 'cargoWeightKg' | 'cargoVolumeM3'>;
    readonly empresaIds: readonly string[];
  },
): Promise<CandidataPorCarga[]> {
  const { trip, empresaIds } = opts;
  if (empresaIds.length === 0) {
    return [];
  }
  // Toda la flota activa de las candidatas, motrices y arrastres, en una
  // consulta. El orden por id hace determinista el resultado.
  const unidades = await tx
    .select({
      id: vehicles.id,
      empresaId: vehicles.empresaId,
      unitCategory: vehicles.unitCategory,
      unitType: vehicles.unitType,
      bodyType: vehicles.bodyType,
      capacityKg: vehicles.capacityKg,
      capacityM3: vehicles.capacityM3,
    })
    .from(vehicles)
    .where(and(inArray(vehicles.empresaId, [...empresaIds]), eq(vehicles.vehicleStatus, 'activo')))
    .orderBy(vehicles.id);

  const flotas = new Map<string, UnidadDeFlota[]>(empresaIds.map((id) => [id, []]));
  for (const { empresaId, ...unidad } of unidades) {
    flotas.get(empresaId)?.push(unidad);
  }
  return candidatasPorCarga(
    { cargoType: trip.cargoType, weightKg: trip.cargoWeightKg, volumeM3: trip.cargoVolumeM3 },
    flotas,
  );
}
