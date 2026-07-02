import { getTableColumns } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { empresas, trips } from '../../src/db/schema.js';

/**
 * Task 1 — opt-in de medición de huella (plan medicion-huella-segmento).
 *
 * Contrato del schema (no toca DB): la empresa lleva el flag de opt-in y el
 * viaje un override nullable. Naming inglés total (decisión PO): columnas SQL
 * en snake_case inglés. Buscamos por nombre SQL para que el test sea type-safe
 * aun antes de que la columna exista (RED limpio, no error de tipos).
 */
describe('opt-in de medición de huella — columnas', () => {
  test('empresas: carbon_measurement_enabled es boolean NOT NULL DEFAULT false', () => {
    const column = Object.values(getTableColumns(empresas)).find(
      (c) => c.name === 'carbon_measurement_enabled',
    );

    expect(column).toBeDefined();
    expect(column?.getSQLType()).toBe('boolean');
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(true);
    expect(column?.default).toBe(false);
  });

  test('trips: carbon_measurement_override es boolean nullable sin default', () => {
    const column = Object.values(getTableColumns(trips)).find(
      (c) => c.name === 'carbon_measurement_override',
    );

    expect(column).toBeDefined();
    expect(column?.getSQLType()).toBe('boolean');
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });
});
