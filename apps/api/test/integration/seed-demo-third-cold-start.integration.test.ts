import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { lookupOrCreateCuentaDemoEmail } from '../../src/services/seed-demo.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T3 SEC-001 Sprint 2a — Integration test: N cold-starts secuenciales NO
 * crecen unbounded `cuentas_demo`.
 *
 * Per spec sec-001-cierre §3 H1.1 SC-1.1.8 v3.2:
 * "tras N cold-starts, count(*) en `demo_accounts` sigue siendo 4 (no
 *  unbounded growth)".
 *
 * Esta test es complementaria a second-cold-start (que valida idempotency
 * estructural): acá validamos que el patrón SELECT-or-INSERT estabiliza
 * en exactamente 4 rows (uno por persona) independientemente del número
 * de invocaciones — protege contra regression accidental del
 * `onConflictDoNothing()` o de la WHERE clause del SELECT.
 */
describe('integration: seed-demo third cold-start (no unbounded growth SC-1.1.8)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await handle.pool.query('TRUNCATE TABLE cuentas_demo');
  });

  test('N=3 cold-starts desde estado vacío → count(*) = 4 (uno por persona)', async () => {
    const personas = ['generador_carga', 'transportista', 'stakeholder', 'conductor'] as const;
    const N = 3;

    // Cada "cold-start" simula que el api server arranca y llama
    // lookupOrCreateCuentaDemoEmail por cada persona. En la primera
    // iteración SELECT miss → INSERT. En las siguientes N-1, SELECT hit
    // → no INSERT. Race-safe via onConflictDoNothing() incluso si dos
    // replicas fueran realmente concurrentes.
    for (let i = 0; i < N; i++) {
      for (const persona of personas) {
        await lookupOrCreateCuentaDemoEmail(handle.db, persona);
      }
    }

    // Total esperado: 4 rows (una por persona), todas active.
    const count = await handle.pool.query<{ c: number }>(
      'SELECT count(*)::int as c FROM cuentas_demo',
    );
    expect(count.rows[0].c).toBe(4);

    // Verifica que las 4 rows son específicamente las personas esperadas
    // con emails determinísticos correctos.
    const rows = await handle.pool.query<{ persona: string; email: string }>(
      'SELECT persona, email FROM cuentas_demo ORDER BY persona',
    );
    expect(rows.rows).toEqual([
      { persona: 'conductor', email: 'drivers+demo-2026-conductor@boosterchile.invalid' },
      { persona: 'generador_carga', email: 'demo-2026-shipper@boosterchile.com' },
      { persona: 'stakeholder', email: 'demo-2026-stakeholder@boosterchile.com' },
      { persona: 'transportista', email: 'demo-2026-carrier@boosterchile.com' },
    ]);
  });

  test('N=5 cold-starts retorna SIEMPRE el mismo email per persona (idempotente)', async () => {
    const emails: string[] = [];
    const N = 5;

    for (let i = 0; i < N; i++) {
      const email = await lookupOrCreateCuentaDemoEmail(handle.db, 'transportista');
      emails.push(email);
    }

    // Todos los N=5 lookups deben retornar exactamente el mismo email.
    expect(new Set(emails).size).toBe(1);
    expect(emails[0]).toBe('demo-2026-carrier@boosterchile.com');

    // Y solo 1 row se materializó (no se duplicó).
    const count = await handle.pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM cuentas_demo WHERE persona='transportista'",
    );
    expect(count.rows[0].c).toBe(1);
  });
});
