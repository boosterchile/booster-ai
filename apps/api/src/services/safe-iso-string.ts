/**
 * Serializa una fecha de Drizzle a ISO sin poder romper la respuesta entera.
 *
 * `Date.prototype.toISOString()` tira `RangeError: Invalid time value` cuando
 * el `Date` tiene time NaN. Como la serialización ocurre dentro del
 * `c.json(...)` de un handler, ese throw no degrada UN campo: se lleva puesto
 * el 200 completo y el cliente recibe un 500 sin pista de cuál fila lo causó.
 *
 * Ya nos pasó en producción: `POST /conductores` devolvía 500 "Invalid time
 * value" por un `.toISOString()` directo. Mejor `null` en un campo que un 500
 * en toda la respuesta.
 *
 * Acepta `string` tal cual porque según el driver y la columna, `pg` puede
 * entregar timestamps ya serializados.
 */
export function safeIsoString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : value.toISOString();
  }
  return typeof value === 'string' ? value : null;
}
