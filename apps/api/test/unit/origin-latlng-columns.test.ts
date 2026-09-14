import { getTableColumns } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { trips } from '../../src/db/schema.js';

/**
 * Task 2 — origen geocodificado (plan medicion-huella-segmento).
 *
 * Contrato del schema (no toca DB): el viaje persiste lat/lng del origen para
 * que el geofence (T8) tenga contra qué comparar. Nullable sin default: un
 * viaje creado antes de la migración, o cuya geocodificación degradó (T4),
 * queda en NULL — nunca en 0/0. Precisión numeric(10,7), la misma que
 * `posiciones_movil_conductor.latitud/longitud`. Naming inglés total (PO).
 * Buscamos por nombre SQL para que el test sea type-safe aun antes de que la
 * columna exista (RED limpio, no error de tipos).
 */
describe('origen geocodificado del viaje — columnas', () => {
  test('trips: origin_latitude es numeric(10, 7) nullable sin default', () => {
    const column = Object.values(getTableColumns(trips)).find((c) => c.name === 'origin_latitude');

    expect(column).toBeDefined();
    expect(column?.getSQLType()).toBe('numeric(10, 7)');
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });

  test('trips: origin_longitude es numeric(10, 7) nullable sin default', () => {
    const column = Object.values(getTableColumns(trips)).find((c) => c.name === 'origin_longitude');

    expect(column).toBeDefined();
    expect(column?.getSQLType()).toBe('numeric(10, 7)');
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });
});
