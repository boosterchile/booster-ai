import { type SQL, sql } from 'drizzle-orm';
import { assignments, rutas } from './schema.js';

/**
 * Vehículo, arrastre y conductor de un servicio (ADR-088, spec
 * ruta-parada-servicio parte 4b).
 *
 * La fuente es la ruta de la asignación. Las columnas homónimas de
 * `asignaciones` se siguen escribiendo (`sincronizar-ruta-de-asignacion.ts`
 * mantiene las dos iguales) hasta la migración `contract` de la parte 8, pero
 * no se leen: una consulta sobre `asignaciones` usa estas expresiones.
 *
 * Una asignación sin ruta entrega sus propias columnas. Solo ocurre con
 * asignaciones anteriores a la migración 0078 que el relleno todavía no
 * alcanzó; así el orden entre el despliegue y el relleno no cambia ninguna
 * respuesta.
 *
 * Las expresiones no agregan un JOIN: leen la ruta por su llave primaria con
 * una subconsulta, de modo que sirven en cualquier consulta que tenga
 * `asignaciones` en el FROM.
 */

const NOMBRE_COLUMNA = {
  vehiculo: sql.raw(`"${rutas.vehicleId.name}"`),
  arrastre: sql.raw(`"${rutas.unidadArrastreId.name}"`),
  conductor: sql.raw(`"${rutas.driverUserId.name}"`),
} as const;

function deLaRuta<T>(columnaRuta: SQL, columnaAsignacion: unknown): SQL<T> {
  return sql<T>`CASE WHEN ${assignments.rutaId} IS NULL THEN ${columnaAsignacion} ELSE (SELECT r.${columnaRuta} FROM ${rutas} r WHERE r."id" = ${assignments.rutaId}) END`;
}

/**
 * Vehículo del servicio. Hoy toda ruta lo tiene; cuando aceptar deje de
 * exigirlo (ADR-090), esta expresión podrá ser nula y su tipo cambia con ella.
 */
export const vehiculoDeAsignacion: SQL<string> = deLaRuta<string>(
  NOMBRE_COLUMNA.vehiculo,
  assignments.vehicleId,
);

export const arrastreDeAsignacion: SQL<string | null> = deLaRuta<string | null>(
  NOMBRE_COLUMNA.arrastre,
  assignments.unidadArrastreId,
);

export const conductorDeAsignacion: SQL<string | null> = deLaRuta<string | null>(
  NOMBRE_COLUMNA.conductor,
  assignments.driverUserId,
);

/**
 * Filtros por conductor o por vehículo. Están escritos como dos ramas con
 * igualdad directa, y no como `expresión = valor`, para que el planificador
 * pueda usar `idx_rutas_conductor` / `idx_rutas_vehiculo` y los índices de
 * `asignaciones`.
 */
function asignacionCon(columnaRuta: SQL, columnaAsignacion: unknown, valor: string): SQL<boolean> {
  return sql<boolean>`((${assignments.rutaId} IS NULL AND ${columnaAsignacion} = ${valor}) OR ${assignments.rutaId} IN (SELECT r."id" FROM ${rutas} r WHERE r.${columnaRuta} = ${valor}))`;
}

/** Asignaciones cuyo conductor es `userId`. */
export function asignacionConConductor(userId: string): SQL<boolean> {
  return asignacionCon(NOMBRE_COLUMNA.conductor, assignments.driverUserId, userId);
}

/** Asignaciones cuyo vehículo motriz es `vehicleId`. */
export function asignacionConVehiculo(vehicleId: string): SQL<boolean> {
  return asignacionCon(NOMBRE_COLUMNA.vehiculo, assignments.vehicleId, vehicleId);
}
