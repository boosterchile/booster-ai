import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { lookupOrCreateCuentaDemoEmail } from '../../src/services/seed-demo.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T3 SEC-001 Sprint 2a — Integration test: second cold-start es no-op.
 *
 * Per spec sec-001-cierre §3 H1.1 SC-1.1.8 v3.2:
 * "estado inicial 4 viejas disabled + 4 nuevas active → cold-start → 0
 *  changes (idempotent)".
 *
 * Esta test valida que `lookupOrCreateCuentaDemoEmail` consultado en un
 * segundo cold-start (estado pre-poblado de un primer cold-start o de T4
 * harden-demo-accounts.ts --recreate) retorna el email existente sin
 * insertar duplicados. La race-safety con `onConflictDoNothing()` es
 * complementaria — esta test cubre el path SELECT hit (no el path
 * INSERT-conflict).
 */
describe('integration: seed-demo second cold-start (idempotent SC-1.1.8)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    // Reset estado: limpia cuentas_demo completamente para cada test
    // (vitest globalSetup ya hizo el DROP SCHEMA + migrations).
    await handle.pool.query('TRUNCATE TABLE cuentas_demo');
  });

  test('SELECT hit retorna email activo sin INSERT (estado: 4 viejas disabled + 4 nuevas active)', async () => {
    // Estado inicial: 4 UIDs viejas disabled + 4 nuevas active
    // (simula post-T4 --retire-old-batch + --recreate).
    await handle.pool.query(`
      INSERT INTO cuentas_demo (persona, email, firebase_uid, creado_en, deshabilitado_en) VALUES
        ('generador_carga', 'demo-shipper@boosterchile.com', 'old-uid-shipper', now() - interval '30 days', now() - interval '1 day'),
        ('transportista',   'demo-carrier@boosterchile.com', 'old-uid-carrier', now() - interval '30 days', now() - interval '1 day'),
        ('stakeholder',     'demo-stakeholder@boosterchile.com', 'old-uid-stakeholder', now() - interval '30 days', now() - interval '1 day'),
        ('conductor',       'drivers+123456785@boosterchile.invalid', 'old-uid-conductor', now() - interval '30 days', now() - interval '1 day'),
        ('generador_carga', 'demo-2026-shipper@boosterchile.com', 'new-uid-shipper', now(), NULL),
        ('transportista',   'demo-2026-carrier@boosterchile.com', 'new-uid-carrier', now(), NULL),
        ('stakeholder',     'demo-2026-stakeholder@boosterchile.com', 'new-uid-stakeholder', now(), NULL),
        ('conductor',       'drivers+demo-2026-conductor@boosterchile.invalid', 'new-uid-conductor', now(), NULL)
    `);

    const initialCount = await handle.pool.query<{ c: number }>(
      'SELECT count(*)::int as c FROM cuentas_demo',
    );
    expect(initialCount.rows[0].c).toBe(8);

    // 4 lookups (uno por persona) — todos deben retornar el email ACTIVO,
    // no el deshabilitado_en NOT NULL.
    const shipperEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'generador_carga');
    const carrierEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'transportista');
    const stakeholderEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'stakeholder');
    const conductorEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'conductor');

    expect(shipperEmail).toBe('demo-2026-shipper@boosterchile.com');
    expect(carrierEmail).toBe('demo-2026-carrier@boosterchile.com');
    expect(stakeholderEmail).toBe('demo-2026-stakeholder@boosterchile.com');
    expect(conductorEmail).toBe('drivers+demo-2026-conductor@boosterchile.invalid');

    // No INSERTs: count sigue siendo 8 (4 disabled + 4 active).
    const finalCount = await handle.pool.query<{ c: number }>(
      'SELECT count(*)::int as c FROM cuentas_demo',
    );
    expect(finalCount.rows[0].c).toBe(8);

    // Y específicamente: las 4 rows disabled siguen disabled, las 4
    // active siguen active — el lookup no muta nada.
    const distribution = await handle.pool.query<{ active: number; disabled: number }>(`
      SELECT
        count(*) FILTER (WHERE deshabilitado_en IS NULL)::int as active,
        count(*) FILTER (WHERE deshabilitado_en IS NOT NULL)::int as disabled
      FROM cuentas_demo
    `);
    expect(distribution.rows[0].active).toBe(4);
    expect(distribution.rows[0].disabled).toBe(4);
  });

  test('persona con solo row disabled (sin active) sí hace INSERT del email determinístico', async () => {
    // Edge case: una persona tiene solo row vieja disabled (e.g. recreate
    // a medias, o data ad-hoc). El lookup debe tratarlo como "no active
    // existe" y crear el row nuevo determinístico.
    await handle.pool.query(`
      INSERT INTO cuentas_demo (persona, email, firebase_uid, creado_en, deshabilitado_en) VALUES
        ('generador_carga', 'demo-shipper@boosterchile.com', 'old-uid-shipper', now() - interval '30 days', now() - interval '1 day')
    `);

    const email = await lookupOrCreateCuentaDemoEmail(handle.db, 'generador_carga');
    expect(email).toBe('demo-2026-shipper@boosterchile.com');

    // Ahora hay 2 rows para generador_carga: 1 disabled + 1 active.
    const rows = await handle.pool.query<{ email: string; deshabilitado_en: Date | null }>(
      "SELECT email, deshabilitado_en FROM cuentas_demo WHERE persona='generador_carga' ORDER BY email",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].email).toBe('demo-2026-shipper@boosterchile.com');
    expect(rows.rows[0].deshabilitado_en).toBeNull();
    expect(rows.rows[1].email).toBe('demo-shipper@boosterchile.com');
    expect(rows.rows[1].deshabilitado_en).not.toBeNull();
  });
});
