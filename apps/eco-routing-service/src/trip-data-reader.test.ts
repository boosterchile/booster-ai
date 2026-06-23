/**
 * TDD — trip-data-reader
 *
 * Cobertura:
 * 1. Happy path: DB retorna row → TripData con todos los campos mapeados correctamente
 * 2. Viaje no encontrado: DB retorna rows vacíos → null + log.debug
 * 3. LEFT JOIN sin asignación: eco_route_polyline_encoded y tipo_combustible NULL → TripData con nulls
 * 4. DB error: db.execute lanza → null + log.error (best-effort, no crash)
 * 5. Row con schema inválido (falla Zod): db.execute retorna row malformado → null + log.error
 */

import type { Logger } from '@booster-ai/logger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';
import { readTripData } from './trip-data-reader.js';

/** Logger mock minimal — cast as Logger para satisfacer el tipo sin instanciar pino */
function buildMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

const VALID_VIAJE_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('readTripData', () => {
  it('happy path: DB retorna row completo → TripData con todos los campos mapeados', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            destino_direccion_raw: "Av. Libertador Bernardo O'Higgins 1234, Santiago",
            eco_route_polyline_encoded: 'aAbBcC123',
            estado: 'en_camino',
            tipo_combustible: 'diesel',
          },
        ],
      }),
    } as unknown as NodePgDatabase<Record<string, unknown>>;
    const logger = buildMockLogger();

    const result = await readTripData({ db: mockDb, viajeId: VALID_VIAJE_ID, logger });

    expect(result).not.toBeNull();
    expect(result?.destinoAddressRaw).toBe("Av. Libertador Bernardo O'Higgins 1234, Santiago");
    expect(result?.ecoRoutePolylineEncoded).toBe('aAbBcC123');
    expect(result?.estado).toBe('en_camino');
    expect(result?.fuelType).toBe('diesel');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('viaje no encontrado: DB retorna rows vacíos → null + log.debug', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce({ rows: [] }),
    } as unknown as NodePgDatabase<Record<string, unknown>>;
    const logger = buildMockLogger();

    const result = await readTripData({ db: mockDb, viajeId: VALID_VIAJE_ID, logger });

    expect(result).toBeNull();
    expect(logger.debug).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledWith(
      { viajeId: VALID_VIAJE_ID },
      'trip-data-reader: viaje no encontrado',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('LEFT JOIN sin asignación: eco_route_polyline_encoded y tipo_combustible NULL → TripData con nulls', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            destino_direccion_raw: 'Ruta 68 km 30, Valparaíso',
            eco_route_polyline_encoded: null,
            estado: 'asignado',
            tipo_combustible: null,
          },
        ],
      }),
    } as unknown as NodePgDatabase<Record<string, unknown>>;
    const logger = buildMockLogger();

    const result = await readTripData({ db: mockDb, viajeId: VALID_VIAJE_ID, logger });

    expect(result).not.toBeNull();
    expect(result?.destinoAddressRaw).toBe('Ruta 68 km 30, Valparaíso');
    expect(result?.ecoRoutePolylineEncoded).toBeNull();
    expect(result?.estado).toBe('asignado');
    expect(result?.fuelType).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('DB error: db.execute lanza → null + log.error (best-effort, no crash)', async () => {
    const dbError = new Error('connection timeout');
    const mockDb = {
      execute: vi.fn().mockRejectedValueOnce(dbError),
    } as unknown as NodePgDatabase<Record<string, unknown>>;
    const logger = buildMockLogger();

    const result = await readTripData({ db: mockDb, viajeId: VALID_VIAJE_ID, logger });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      { err: dbError, viajeId: VALID_VIAJE_ID },
      'trip-data-reader: DB error (best-effort), retornando null',
    );
  });

  it('row con schema inválido (falla Zod): db.execute retorna row malformado → null + log.error', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            // destino_direccion_raw falta (requerido por schema)
            eco_route_polyline_encoded: 'xyz',
            estado: 123, // tipo incorrecto: debería ser string
            tipo_combustible: null,
          },
        ],
      }),
    } as unknown as NodePgDatabase<Record<string, unknown>>;
    const logger = buildMockLogger();

    const result = await readTripData({ db: mockDb, viajeId: VALID_VIAJE_ID, logger });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledOnce();
    // Verificar que se pasó el viajeId y zodErrors en el primer argumento
    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const firstCall = errorCalls[0] ?? [];
    expect(firstCall[0]).toMatchObject({ viajeId: VALID_VIAJE_ID });
    expect(firstCall[0]).toHaveProperty('zodErrors');
    expect(firstCall[1]).toBe('trip-data-reader: validacion Zod fallo en row');
  });
});
