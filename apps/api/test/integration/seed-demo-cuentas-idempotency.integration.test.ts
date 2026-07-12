import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { lookupOrCreateCuentaDemoEmail } from '../../src/services/cuentas-demo.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T3 SEC-001 Sprint 2a — Integration tests para idempotency de
 * `lookupOrCreateCuentaDemoEmail` (spec sec-001-cierre §3 H1.1 SC-1.1.8
 * v3.2). Cubre dos escenarios:
 *
 * 1. **second-cold-start**: estado pre-poblado (4 viejas disabled + 4 nuevas
 *    active, simulando post-T4 retire+recreate) → lookups retornan email
 *    activo sin INSERT.
 * 2. **third-cold-start**: N cold-starts desde estado vacío → count(*) = 4
 *    (uno por persona); no unbounded growth.
 *
 * Ambos escenarios viven en el MISMO archivo (con un beforeEach común) para
 * que vitest los ejecute estrictamente serial dentro de la misma describe.
 * Versión previa estaban en archivos separados — entre files se observó
 * cross-file state pollution porque la `handle.pool` se recrea per file
 * pero la BD subyacente es la misma (singleFork no garantiza file-level
 * isolation completo de connection state).
 */
describe('integration: cuentas_demo lookupOrCreateCuentaDemoEmail idempotency (SC-1.1.8)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    // DELETE en lugar de TRUNCATE: garantiza MVCC visibility para cualquier
    // connection del pool sin requerir DDL lock. Verificación post-DELETE
    // (assertion count = 0) atrapa cualquier state leak antes que cada test.
    await handle.pool.query('DELETE FROM cuentas_demo');
    const after = await handle.pool.query<{ c: number }>(
      'SELECT count(*)::int as c FROM cuentas_demo',
    );
    expect(after.rows[0].c).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // second-cold-start
  // ─────────────────────────────────────────────────────────────────────

  test('second cold-start: SELECT hit retorna email activo sin INSERT (4 viejas disabled + 4 nuevas active)', async () => {
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

    const shipperEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'generador_carga');
    const carrierEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'transportista');
    const stakeholderEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'stakeholder');
    const conductorEmail = await lookupOrCreateCuentaDemoEmail(handle.db, 'conductor');

    expect(shipperEmail).toBe('demo-2026-shipper@boosterchile.com');
    expect(carrierEmail).toBe('demo-2026-carrier@boosterchile.com');
    expect(stakeholderEmail).toBe('demo-2026-stakeholder@boosterchile.com');
    expect(conductorEmail).toBe('drivers+demo-2026-conductor@boosterchile.invalid');

    const finalCount = await handle.pool.query<{ c: number }>(
      'SELECT count(*)::int as c FROM cuentas_demo',
    );
    expect(finalCount.rows[0].c).toBe(8);

    const distribution = await handle.pool.query<{ active: number; disabled: number }>(`
      SELECT
        count(*) FILTER (WHERE deshabilitado_en IS NULL)::int as active,
        count(*) FILTER (WHERE deshabilitado_en IS NOT NULL)::int as disabled
      FROM cuentas_demo
    `);
    expect(distribution.rows[0].active).toBe(4);
    expect(distribution.rows[0].disabled).toBe(4);
  });

  test('persona con solo row disabled (sin active) hace INSERT del email determinístico', async () => {
    await handle.pool.query(`
      INSERT INTO cuentas_demo (persona, email, firebase_uid, creado_en, deshabilitado_en) VALUES
        ('generador_carga', 'demo-shipper@boosterchile.com', 'old-uid-shipper', now() - interval '30 days', now() - interval '1 day')
    `);

    const email = await lookupOrCreateCuentaDemoEmail(handle.db, 'generador_carga');
    expect(email).toBe('demo-2026-shipper@boosterchile.com');

    const rows = await handle.pool.query<{ email: string; deshabilitado_en: Date | null }>(
      "SELECT email, deshabilitado_en FROM cuentas_demo WHERE persona='generador_carga' ORDER BY email",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].email).toBe('demo-2026-shipper@boosterchile.com');
    expect(rows.rows[0].deshabilitado_en).toBeNull();
    expect(rows.rows[1].email).toBe('demo-shipper@boosterchile.com');
    expect(rows.rows[1].deshabilitado_en).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // third-cold-start (no unbounded growth)
  // ─────────────────────────────────────────────────────────────────────

  test('N=3 cold-starts desde estado vacío → count(*) = 4 (uno por persona)', async () => {
    const personas = ['generador_carga', 'transportista', 'stakeholder', 'conductor'] as const;
    const N = 3;

    for (let i = 0; i < N; i++) {
      for (const persona of personas) {
        await lookupOrCreateCuentaDemoEmail(handle.db, persona);
      }
    }

    const count = await handle.pool.query<{ c: number }>(
      'SELECT count(*)::int as c FROM cuentas_demo',
    );
    expect(count.rows[0].c).toBe(4);

    // ORDER BY email (text) garantiza orden alfabético; pgEnum ORDER BY
    // ordena por DEFINICION del enum (CREATE TYPE order), no alfabético.
    const rows = await handle.pool.query<{ persona: string; email: string }>(
      'SELECT persona, email FROM cuentas_demo ORDER BY email',
    );
    expect(rows.rows).toEqual([
      { persona: 'transportista', email: 'demo-2026-carrier@boosterchile.com' },
      { persona: 'generador_carga', email: 'demo-2026-shipper@boosterchile.com' },
      { persona: 'stakeholder', email: 'demo-2026-stakeholder@boosterchile.com' },
      { persona: 'conductor', email: 'drivers+demo-2026-conductor@boosterchile.invalid' },
    ]);
  });

  test('N=5 invocaciones consecutivas retornan SIEMPRE el mismo email per persona', async () => {
    const emails: string[] = [];
    const N = 5;

    for (let i = 0; i < N; i++) {
      const email = await lookupOrCreateCuentaDemoEmail(handle.db, 'transportista');
      emails.push(email);
    }

    expect(new Set(emails).size).toBe(1);
    expect(emails[0]).toBe('demo-2026-carrier@boosterchile.com');

    const count = await handle.pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM cuentas_demo WHERE persona='transportista'",
    );
    expect(count.rows[0].c).toBe(1);
  });
});
