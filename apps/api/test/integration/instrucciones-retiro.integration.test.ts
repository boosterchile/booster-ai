import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * instrucciones-retiro SC1 contra Postgres real: la migración 0072 crea la
 * tabla con una fila por viaje, exige archivo o nota y que el archivo venga
 * con su tipo.
 */
describe('integration: instrucciones_retiro (migración 0072)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function viaje(): Promise<string> {
    const [trip] = await handle.db
      .insert(schema.trips)
      .values({
        trackingCode: `RT${randomUUID().slice(0, 8)}`,
        originAddressRaw: 'Origen 1',
        destinationAddressRaw: 'Destino 2',
        cargoType: 'carga_seca',
        cargoWeightKg: 1000,
        pickupDateRaw: '2026-11-10',
        pickupWindowStart: new Date('2026-11-10T12:00:00Z'),
        status: 'esperando_match',
      })
      .returning({ id: schema.trips.id });
    if (!trip) {
      throw new Error('fixture: viaje no creado');
    }
    return trip.id;
  }

  async function insertar(viajeId: string, campos: Record<string, string | null>) {
    const cols = ['viaje_id', ...Object.keys(campos)];
    const vals = [viajeId, ...Object.values(campos)];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
    return handle.pool.query(
      `INSERT INTO instrucciones_retiro (${cols.join(', ')}) VALUES (${placeholders})`,
      vals,
    );
  }

  test('la tabla existe con sus columnas', async () => {
    const r = await handle.db.execute<{ column_name: string; is_nullable: string }>(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'instrucciones_retiro' ORDER BY column_name`);
    const columnas = Object.fromEntries(r.rows.map((c) => [c.column_name, c.is_nullable]));
    expect(columnas).toEqual({
      actualizado_en: 'NO',
      archivo_mime: 'YES',
      archivo_path: 'YES',
      creado_en: 'NO',
      id: 'NO',
      lugar: 'YES',
      nota: 'YES',
      subido_por: 'YES',
      viaje_id: 'NO',
    });
  });

  test('acepta archivo con su tipo, o solo una nota', async () => {
    await insertar(await viaje(), {
      archivo_path: 'instrucciones-retiro/x/a.png',
      archivo_mime: 'image/png',
    });
    await insertar(await viaje(), { nota: 'Andén 4, preguntar por Juan' });
  });

  test('una sola fila por viaje', async () => {
    const id = await viaje();
    await insertar(id, { nota: 'primera' });
    await expect(insertar(id, { nota: 'segunda' })).rejects.toThrow(/unique|duplicate/i);
  });

  test('rechaza una fila sin archivo ni nota', async () => {
    await expect(insertar(await viaje(), { lugar: 'Bodega Sur' })).rejects.toThrow(/check/i);
  });

  test('rechaza archivo sin tipo y tipo sin archivo', async () => {
    await expect(
      insertar(await viaje(), { archivo_path: 'instrucciones-retiro/x/a.png', nota: 'n' }),
    ).rejects.toThrow(/check/i);
    await expect(insertar(await viaje(), { archivo_mime: 'image/png', nota: 'n' })).rejects.toThrow(
      /check/i,
    );
  });

  test('no se puede borrar el viaje mientras tenga instrucciones', async () => {
    const id = await viaje();
    await insertar(id, { nota: 'n' });
    await expect(handle.pool.query('DELETE FROM viajes WHERE id = $1', [id])).rejects.toThrow(
      /foreign key|violates/i,
    );
  });
});
