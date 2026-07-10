import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eventosImpersonacion, users } from '../../src/db/schema.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Integration — migración 0049 (eventos_impersonacion). Verifica contra
 * Postgres real (TEST_DATABASE_URL + migraciones de globalSetup) que la tabla
 * de auditoría de impersonación existe, hace round-trip, y que sus FKs
 * ON DELETE RESTRICT protegen el rastro de auditoría.
 */

const SUFFIX = 'imp-evt-it';

async function insertUser(handle: TestDbHandle, tag: string): Promise<string> {
  const rows = await handle.db
    .insert(users)
    .values({
      firebaseUid: `fb-${SUFFIX}-${tag}`,
      email: `${SUFFIX}-${tag}@boosterchile.invalid`,
      fullName: `IT ${tag}`,
    })
    .returning({ id: users.id });
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('insertUser: sin id');
  }
  return id;
}

describe('integration: eventos_impersonacion (migración 0049)', () => {
  let handle: TestDbHandle;
  let adminId: string;
  let targetId: string;

  beforeAll(async () => {
    handle = createTestDb();
    adminId = await insertUser(handle, 'admin');
    targetId = await insertUser(handle, 'target');
  });

  afterAll(async () => {
    await handle.db
      .delete(eventosImpersonacion)
      .where(eq(eventosImpersonacion.adminUserId, adminId));
    await handle.db.delete(users).where(eq(users.id, adminId));
    await handle.db.delete(users).where(eq(users.id, targetId));
    await handle.pool.end();
  });

  test('la tabla `eventos_impersonacion` existe tras runMigrations', async () => {
    const result = await handle.pool.query<{ regclass: string | null }>(
      "SELECT to_regclass('public.eventos_impersonacion')::text AS regclass",
    );
    expect(result.rows[0]?.regclass).toBe('eventos_impersonacion');
  });

  test('round-trip: inserta evento (empresa_id null, finalizado_en null) y lee de vuelta', async () => {
    const inserted = await handle.db
      .insert(eventosImpersonacion)
      .values({ adminUserId: adminId, targetUserId: targetId, empresaId: null })
      .returning();
    const row = inserted[0];
    expect(row).toBeDefined();
    expect(row?.adminUserId).toBe(adminId);
    expect(row?.targetUserId).toBe(targetId);
    expect(row?.empresaId).toBeNull();
    expect(row?.startedAt).toBeInstanceOf(Date);
    expect(row?.endedAt).toBeNull();

    // "Salir": setear finalizado_en.
    await handle.db
      .update(eventosImpersonacion)
      .set({ endedAt: new Date() })
      .where(eq(eventosImpersonacion.id, row?.id ?? ''));
    const after = await handle.db
      .select()
      .from(eventosImpersonacion)
      .where(eq(eventosImpersonacion.id, row?.id ?? ''));
    expect(after[0]?.endedAt).toBeInstanceOf(Date);
  });

  test('FK ON DELETE RESTRICT: no se puede borrar un usuario con eventos de auditoría', async () => {
    await handle.db
      .insert(eventosImpersonacion)
      .values({ adminUserId: adminId, targetUserId: targetId, empresaId: null });

    // Borrar el admin referenciado debe fallar por la FK RESTRICT.
    await expect(handle.db.delete(users).where(eq(users.id, adminId))).rejects.toThrow();
  });
});
