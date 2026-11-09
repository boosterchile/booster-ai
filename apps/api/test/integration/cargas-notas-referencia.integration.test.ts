import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas M1 (PR3) contra Postgres real: notas y referencia en
 * `viajes`, con su tope, y los tipos de evento de edición en el enum.
 */
describe('integration: notas, referencia y eventos de edición (migración 0074)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function columna(nombre: string) {
    const r = await handle.db.execute<{
      data_type: string;
      is_nullable: string;
      character_maximum_length: number | null;
    }>(sql`
      SELECT data_type, is_nullable, character_maximum_length
      FROM information_schema.columns WHERE table_name = 'viajes' AND column_name = ${nombre}`);
    return r.rows[0] ?? null;
  }

  test('viajes.notas: text nulo; viajes.referencia: varchar(100) nulo', async () => {
    expect(await columna('notas')).toEqual({
      data_type: 'text',
      is_nullable: 'YES',
      character_maximum_length: null,
    });
    expect(await columna('referencia')).toEqual({
      data_type: 'character varying',
      is_nullable: 'YES',
      character_maximum_length: 100,
    });
  });

  test('las notas no pasan de 1000 caracteres', async () => {
    const insertar = (notas: string) =>
      handle.db.insert(schema.trips).values({
        trackingCode: `NT${randomUUID().slice(0, 8)}`,
        originAddressRaw: 'A',
        destinationAddressRaw: 'B',
        cargoType: 'carga_seca',
        cargoWeightKg: 1000,
        pickupDateRaw: '2026-11-20',
        notes: notas,
      });
    await insertar('x'.repeat(1000));
    await expect(insertar('x'.repeat(1001))).rejects.toThrow(/check|notas/i);
  });

  test('tipo_evento_viaje incluye los eventos de edición', async () => {
    const r = await handle.db.execute<{ v: string }>(sql`
      SELECT unnest(enum_range(NULL::tipo_evento_viaje))::text AS v`);
    const valores = r.rows.map((x) => x.v);
    expect(valores).toEqual(
      expect.arrayContaining(['carga_editada', 'cambio_solicitado', 'cambio_respondido']),
    );
  });
});
