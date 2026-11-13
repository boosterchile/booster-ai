import { and, eq, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../../db/client.js';
import { vehiculoDeAsignacion } from '../../db/configuracion-de-asignacion.js';
import { assignments, empresas, tripMetrics, trips, vehicles } from '../../db/schema.js';
import type { ViajeEntregado } from './proyeccion.js';

/**
 * Fuente del observatorio (ADR-012 Capa 2): viajes `entregado` con su
 * asignación entregada, el tipo del vehículo y las métricas de huella. Deja
 * fuera los viajes de generadores demo o de prueba: un observatorio con
 * datos sintéticos le mentiría al municipio.
 */
export async function leerViajesEntregados(db: Db): Promise<ViajeEntregado[]> {
  const generador = alias(empresas, 'generador');
  // rls-allowlist: export platform-wide y agregado del observatorio (ADR-012 §Privacidad: solo agregados k ≥ 10 salen del sistema).
  return await db
    .select({
      viajeId: trips.id,
      vehiculoId: vehiculoDeAsignacion,
      origenRegion: trips.originRegionCode,
      origenComuna: trips.originComunaCode,
      destinoRegion: trips.destinationRegionCode,
      destinoComuna: trips.destinationComunaCode,
      recogidoEn: assignments.pickedUpAt,
      entregadoEn: assignments.deliveredAt,
      tipoVehiculo: vehicles.vehicleType,
      distanciaKm: tripMetrics.distanceKmEstimated,
      kgco2eReales: tripMetrics.carbonEmissionsKgco2eActual,
      kgco2eEstimadas: tripMetrics.carbonEmissionsKgco2eEstimated,
      kgco2eEvitado: tripMetrics.ahorroCo2eVsSinMatchingKgco2e,
    })
    .from(trips)
    .innerJoin(assignments, eq(assignments.tripId, trips.id))
    .innerJoin(vehicles, eq(vehicles.id, vehiculoDeAsignacion))
    .innerJoin(generador, eq(generador.id, trips.generadorCargaEmpresaId))
    .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
    .where(
      and(
        eq(trips.status, 'entregado'),
        isNotNull(assignments.deliveredAt),
        eq(generador.isDemo, false),
        eq(generador.isTestUser, false),
      ),
    )
    .then((filas) =>
      filas.flatMap((f) =>
        // deliveredAt y vehículo son NOT NULL por el WHERE / INNER JOIN; el
        // tipo de Drizzle no lo sabe (vehiculoDeAsignacion es string | null).
        f.entregadoEn && f.vehiculoId
          ? [{ ...f, entregadoEn: f.entregadoEn, vehiculoId: f.vehiculoId }]
          : [],
      ),
    );
}
