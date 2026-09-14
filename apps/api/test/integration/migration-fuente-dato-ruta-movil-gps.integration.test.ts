import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ADR-077 §1 — verificación a nivel DB de que la migración 0055 agregó
 * `movil_gps` al enum `fuente_dato_ruta` de forma EXPAND-ONLY (globalSetup
 * corre `runMigrations` real, el mismo código que prod).
 *
 * Qué prueba y por qué:
 *   1. El valor nuevo existe → sin él, Task 11 no puede persistir la fuente
 *      real cuando el viaje se mide con la posición del móvil del conductor.
 *   2. Los tres valores previos de ADR-028 §1 siguen presentes → un enum es
 *      un contrato de datos: `teltonika_gps`, `maps_directions` y
 *      `manual_declared` ya están escritos en filas de `metricas_viaje`.
 *      Perder uno rompería el histórico y `derivarNivelCertificacion`.
 *   3. El orden relativo de los tres previos no cambió y `movil_gps` quedó
 *      al final → `ADD VALUE` sin `BEFORE`/`AFTER` appendea; si alguien
 *      reescribe la migración recreando el tipo, este assert lo caza.
 *   4. El valor es usable como literal casteado → prueba que la transacción
 *      del migrator commiteó (en Postgres el valor nuevo no se puede usar
 *      dentro de la MISMA transacción que lo agregó; ver cabecera de la
 *      migración 0055).
 */
interface EnumLabelRow {
  enumlabel: string;
}

const ENUM_LABELS_QUERY = `SELECT e.enumlabel
     FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'fuente_dato_ruta' AND n.nspname = 'public'
    ORDER BY e.enumsortorder`;

/** Los tres valores de ADR-028 §1, en el orden en que los creó la 0009. */
const VALORES_PREVIOS = ['teltonika_gps', 'maps_directions', 'manual_declared'] as const;

describe('integration: enum fuente_dato_ruta + movil_gps (0055, ADR-077)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('el enum expone `movil_gps`', async () => {
    const result = await handle.pool.query<EnumLabelRow>(ENUM_LABELS_QUERY);
    const labels = result.rows.map((r) => r.enumlabel);

    expect(labels).toContain('movil_gps');
  });

  test('los tres valores previos de ADR-028 siguen presentes', async () => {
    const result = await handle.pool.query<EnumLabelRow>(ENUM_LABELS_QUERY);
    const labels = result.rows.map((r) => r.enumlabel);

    for (const valor of VALORES_PREVIOS) {
      expect(labels, `falta el valor previo '${valor}' — la migración NO es expand-only`).toContain(
        valor,
      );
    }
  });

  test('expand-only: los previos conservan su orden y `movil_gps` va al final', async () => {
    const result = await handle.pool.query<EnumLabelRow>(ENUM_LABELS_QUERY);
    const labels = result.rows.map((r) => r.enumlabel);

    expect(labels).toEqual([...VALORES_PREVIOS, 'movil_gps']);
  });

  test('`movil_gps` es usable como literal del tipo (la transacción commiteó)', async () => {
    const result = await handle.pool.query<{ fuente: string }>(
      "SELECT 'movil_gps'::fuente_dato_ruta::text AS fuente",
    );

    expect(result.rows[0].fuente).toBe('movil_gps');
  });
});
