import { getTableColumns } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { empresas } from '../../src/db/schema.js';

/**
 * Slice 2 — umbrales de robo de combustible por empresa.
 * NULL = default de dominio. El rango lo cierra el CHECK de la migración 0056.
 */
describe('umbrales de robo de combustible — columnas', () => {
  test('empresas: golpe y hormiga son integer nullable sin default', () => {
    const columnas = Object.values(getTableColumns(empresas));
    for (const nombre of ['umbral_robo_golpe_l', 'umbral_robo_hormiga_l'] as const) {
      const column = columnas.find((c) => c.name === nombre);
      expect(column).toBeDefined();
      expect(column?.getSQLType()).toBe('integer');
      expect(column?.notNull).toBe(false);
      expect(column?.hasDefault).toBe(false);
    }
  });
});
