import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * seguimiento-por-correo SC1 contra Postgres real: la migración 0073 agrega el
 * correo del destinatario y las marcas de idempotencia del enlace por correo y
 * por WhatsApp, todas nulas.
 */
describe('integration: columnas de seguimiento por correo (migración 0073)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function columna(tabla: string, nombre: string) {
    const r = await handle.db.execute<{
      data_type: string;
      is_nullable: string;
      character_maximum_length: number | null;
    }>(sql`
      SELECT data_type, is_nullable, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = ${tabla} AND column_name = ${nombre}`);
    return r.rows[0] ?? null;
  }

  test('viajes.destinatario_email: varchar(254) nulo', async () => {
    expect(await columna('viajes', 'destinatario_email')).toEqual({
      data_type: 'character varying',
      is_nullable: 'YES',
      character_maximum_length: 254,
    });
  });

  test.each(['tracking_link_email_enviado_en', 'tracking_link_enviado_en'])(
    'asignaciones.%s: timestamptz nulo',
    async (nombre) => {
      expect(await columna('asignaciones', nombre)).toEqual({
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        character_maximum_length: null,
      });
    },
  );
});
