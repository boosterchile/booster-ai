import type { IngestResult } from '@booster-ai/transport-documents';
import { PGlite } from '@electric-sql/pglite';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleDocumentStore } from './document-store.js';

/**
 * Test de la capa SQL del worker TED (dominio crítico: retención legal SII
 * 6 años, O-3). Dos niveles:
 *
 *  1. ESTRUCTURAL: stubea `db.execute` capturando el objeto `sql` de Drizzle y
 *     lo compila con `PgDialect` para inspeccionar el SQL generado y sus binds.
 *     Pinea la FORMA del UPDATE (ancla estricta por CASE, sin GREATEST).
 *  2. BEHAVIORAL (pglite): ejecuta el SQL real contra un Postgres en proceso
 *     (WASM) y verifica el VALOR final de `retention_until`/`fecha_emision`.
 *     Prueba la invariante O-3 contra la semántica real de Postgres, no solo
 *     contra la forma del SQL.
 *
 * Regla de anclaje (decisión del PO, ADR-070 / O-3):
 *   - `fecha_emision` válida  → `retention_until = fecha_emision + 6a`.
 *   - sin `fecha_emision`     → fallback `created_at + 6a`.
 *   - Recalcular al decodificar SOLO si el valor previo estaba en fallback
 *     (la fila aún NO tiene `fecha_emision`). NUNCA pisar hacia abajo una
 *     retención ya anclada a una `fecha_emision` válida.
 *   Discriminante: el valor PREVIO de la columna `fecha_emision` (Postgres
 *   evalúa el RHS de un UPDATE contra la fila pre-update) — IS NULL ⇒ era
 *   fallback/sin anclar ⇒ se recalcula; IS NOT NULL ⇒ anclada ⇒ se preserva.
 */

const dialect = new PgDialect();

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * Stub de `NodePgDatabase`: captura cada `db.execute(sql\`...\`)`, compila el
 * SQL object a texto + params, y devuelve `rows` configurables por llamada.
 */
function makeDbStub(returns: Array<{ rows: unknown[] }> = []): {
  db: NodePgDatabase;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  let i = 0;
  const execute = vi.fn(async (query: unknown) => {
    // `query` es el SQL object de Drizzle (lo que produce el tagged template).
    const built = dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]);
    calls.push({ sql: built.sql, params: built.params });
    const r = returns[i++] ?? { rows: [] };
    return r;
  });
  return { db: { execute } as unknown as NodePgDatabase, calls };
}

const DOC_ID = '11111111-1111-1111-1111-111111111111';

function decoded(
  fechaEmision: string | null,
  retentionUntil: string,
): Extract<IngestResult, { status: 'decodificado' }> {
  return {
    status: 'decodificado',
    fields: {
      rutEmisor: '76111111-1',
      docType: '52',
      folio: '67',
      fechaEmision,
      rutReceptor: '12345678-5',
      razonSocialReceptor: 'Comprador S.A.',
      razonSocialEmisor: null,
      montoTotal: '24365',
    },
    tedRaw: '<TED>...</TED>',
    retentionUntil,
    needsRetentionReview: fechaEmision === null,
  };
}

describe('createDrizzleDocumentStore — capa SQL del worker TED', () => {
  describe('claimForProcessing — claim condicional por estado (idempotencia)', () => {
    it('toma la fila solo si está en pendiente/fallido y devuelve true si actualizó una fila', async () => {
      const { db, calls } = makeDbStub([{ rows: [{ id: DOC_ID }] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      const claimed = await store.claimForProcessing(DOC_ID);
      expect(claimed).toBe(true);
      expect(calls[0]?.sql).toContain("SET extraction_status = 'procesando'");
      expect(calls[0]?.sql).toContain("extraction_status IN ('pendiente', 'fallido')");
      expect(calls[0]?.params).toContain(DOC_ID);
    });

    it('devuelve false si ningún row matcheó el estado (ya procesando/decodificado)', async () => {
      const { db } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      expect(await store.claimForProcessing(DOC_ID)).toBe(false);
    });
  });

  describe('loadCreatedAt', () => {
    it('devuelve el creado_en como Date cuando la fila existe', async () => {
      const { db } = makeDbStub([{ rows: [{ creado_en: '2026-06-18T00:00:00Z' }] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      const at = await store.loadCreatedAt(DOC_ID);
      expect(at).toBeInstanceOf(Date);
      expect(at?.toISOString()).toBe('2026-06-18T00:00:00.000Z');
    });

    it('devuelve null si la fila no existe', async () => {
      const { db } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      expect(await store.loadCreatedAt(DOC_ID)).toBeNull();
    });
  });

  describe('persistDecoded — forma del UPDATE (ancla estricta, sin GREATEST)', () => {
    it('ancla fecha_emision y retention_until vía CASE WHEN fecha_emision IS NULL — nunca GREATEST/COALESCE', async () => {
      const { db, calls } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      await store.persistDecoded(DOC_ID, decoded('2026-06-11', '2032-06-11'));
      const sqlNorm = (calls[0]?.sql ?? '').replace(/\s+/g, ' ');
      // El discriminante es el valor PREVIO de fecha_emision (pre-update).
      expect(sqlNorm).toMatch(
        /fecha_emision = CASE WHEN fecha_emision IS NULL THEN \$\d+::date ELSE fecha_emision END/,
      );
      expect(sqlNorm).toMatch(
        /retention_until = CASE WHEN fecha_emision IS NULL THEN \$\d+::date ELSE retention_until END/,
      );
      // El enfoque GREATEST/COALESCE (que retendría de más anclando a created_at+6a) queda PROHIBIDO.
      expect(sqlNorm).not.toContain('GREATEST');
      expect(sqlNorm).not.toContain('COALESCE');
      // Ni un set incondicional plano que pisaría una retención ya anclada.
      expect(sqlNorm).not.toMatch(/retention_until = \$\d+::date ,/);
      // El valor nuevo (fecha + retención) viaja como bind.
      expect(calls[0]?.params).toContain('2026-06-11');
      expect(calls[0]?.params).toContain('2032-06-11');
    });

    it('mapea los campos del <DD> a sus columnas (RE→rut_emisor, RR→rut_receptor, RSR→razon_social_receptor)', async () => {
      const { db, calls } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      await store.persistDecoded(DOC_ID, decoded('2026-06-11', '2032-06-11'));
      const params = calls[0]?.params ?? [];
      expect(params).toContain('76111111-1'); // rut_emisor
      expect(params).toContain('12345678-5'); // rut_receptor
      expect(params).toContain('Comprador S.A.'); // razon_social_receptor
      expect(params).toContain('24365'); // monto_total
      expect(calls[0]?.sql).toContain("extraction_status = 'decodificado'");
    });
  });

  describe('markFailed', () => {
    it('marca la fila como fallido (se conserva, no se borra) y loguea con la razón', async () => {
      const { db, calls } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      await store.markFailed(DOC_ID, 'no_pdf417_found');
      expect(calls[0]?.sql).toContain("SET extraction_status = 'fallido'");
      expect(calls[0]?.params).toContain(DOC_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // BEHAVIORAL — Postgres real (pglite, en proceso) ejecuta el UPDATE de
  // persistDecoded y verificamos el VALOR final de la columna. Cubre los 3
  // casos que pidió el PO: (a) ancla a fecha_emision+6a; (b) fallback
  // created_at+6a; (c) re-decode NO acorta una retención ya anclada.
  // ---------------------------------------------------------------------------
  describe('persistDecoded — comportamiento contra Postgres real (pglite, invariante O-3)', () => {
    let pg: PGlite;

    /** db `NodePgDatabase`-shaped que ejecuta el SQL real de Drizzle en pglite. */
    function makePgliteDb(): NodePgDatabase {
      const execute = async (query: unknown): Promise<{ rows: unknown[] }> => {
        const built = dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]);
        const res = await pg.query(built.sql, built.params as unknown[]);
        return { rows: res.rows };
      };
      return { execute } as unknown as NodePgDatabase;
    }

    /** Lee fecha_emision/retention_until como ISO date (YYYY-MM-DD) o null. */
    async function readDates(
      id: string,
    ): Promise<{ fecha: string | null; retention: string | null }> {
      const res = await pg.query<{ fecha: string | null; retention: string | null }>(
        `SELECT to_char(fecha_emision, 'YYYY-MM-DD') AS fecha,
                to_char(retention_until, 'YYYY-MM-DD') AS retention
         FROM documentos_transporte WHERE id = $1`,
        [id],
      );
      const row = res.rows[0];
      return { fecha: row?.fecha ?? null, retention: row?.retention ?? null };
    }

    // PGlite arranca un Postgres WASM en proceso: la PRIMERA init (carga del
    // .wasm + bootstrap del cluster) es cara y, en runners de CI cargados,
    // rozaba el hookTimeout default de 10s si se hacía por test (beforeEach) →
    // flaky "Hook timed out". La pagamos UNA sola vez en beforeAll (con timeout
    // holgado) y limpiamos filas por test con un DELETE barato.
    beforeAll(async () => {
      pg = new PGlite();
      // Tabla mínima con los tipos que importan a la retención (date) y texto
      // para el resto (evita recrear los enums; el foco es la semántica de
      // fecha_emision/retention_until, no las constraints de enum).
      await pg.exec(`
        CREATE TABLE documentos_transporte (
          id text PRIMARY KEY,
          extraction_status text,
          doc_type text,
          folio text,
          rut_emisor text,
          rut_receptor text,
          razon_social_receptor text,
          monto_total numeric,
          ted_raw text,
          fecha_emision date,
          retention_until date,
          actualizado_en timestamptz
        );
      `);
    }, 30000);

    afterAll(async () => {
      await pg.close();
    });

    beforeEach(async () => {
      await pg.exec('DELETE FROM documentos_transporte;');
    });

    it('(a) fila en fallback (fecha_emision NULL, retención = created_at+6a) + FE válida → ancla a fecha_emision+6a aunque sea MENOR que el fallback', async () => {
      // Estado previo: retención conservadora created_at+6a (2032-12-31), SIN
      // fecha_emision (fallback no anclado).
      await pg.exec(
        `INSERT INTO documentos_transporte (id, extraction_status, fecha_emision, retention_until)
         VALUES ('${DOC_ID}', 'pendiente', NULL, DATE '2032-12-31');`,
      );
      const store = createDrizzleDocumentStore({ db: makePgliteDb(), logger });
      // Decode con FE válida 2026-06-11 → FE+6a = 2032-06-11 (MENOR que 2032-12-31).
      await store.persistDecoded(DOC_ID, decoded('2026-06-11', '2032-06-11'));
      const { fecha, retention } = await readDates(DOC_ID);
      // La regla del PO: en fallback SE recalcula a la base legal (emisión),
      // aunque eso reduzca un fallback conservador. GREATEST habría dejado 2032-12-31.
      expect(retention).toBe('2032-06-11');
      expect(fecha).toBe('2026-06-11');
    });

    it('(b) decode SIN fecha_emision → fallback created_at+6a; fecha_emision queda NULL', async () => {
      await pg.exec(
        `INSERT INTO documentos_transporte (id, extraction_status, fecha_emision, retention_until)
         VALUES ('${DOC_ID}', 'pendiente', NULL, NULL);`,
      );
      const store = createDrizzleDocumentStore({ db: makePgliteDb(), logger });
      // TED decodificado pero sin <FE>: el ingestor entrega el fallback created_at+6a.
      await store.persistDecoded(DOC_ID, decoded(null, '2032-06-18'));
      const { fecha, retention } = await readDates(DOC_ID);
      expect(retention).toBe('2032-06-18');
      expect(fecha).toBeNull();
    });

    it('(c) re-decode de una fila YA anclada a una fecha_emision válida → NO acorta (ni retención ni fecha)', async () => {
      // Fila anclada: fecha_emision 2020-01-15 → retención 2026-01-15.
      await pg.exec(
        `INSERT INTO documentos_transporte (id, extraction_status, fecha_emision, retention_until)
         VALUES ('${DOC_ID}', 'decodificado', DATE '2020-01-15', DATE '2026-01-15');`,
      );
      const store = createDrizzleDocumentStore({ db: makePgliteDb(), logger });
      // Re-decode con FE ANTERIOR (2019-01-01 → 2025-01-01) que acortaría.
      await store.persistDecoded(DOC_ID, decoded('2019-01-01', '2025-01-01'));
      const { fecha, retention } = await readDates(DOC_ID);
      // Preservadas: la retención anclada nunca se pisa hacia abajo.
      expect(retention).toBe('2026-01-15');
      expect(fecha).toBe('2020-01-15');
    });

    it('(c-bis) re-decode con FE POSTERIOR tampoco re-ancla una fila ya anclada (idempotente, no extiende)', async () => {
      await pg.exec(
        `INSERT INTO documentos_transporte (id, extraction_status, fecha_emision, retention_until)
         VALUES ('${DOC_ID}', 'decodificado', DATE '2020-01-15', DATE '2026-01-15');`,
      );
      const store = createDrizzleDocumentStore({ db: makePgliteDb(), logger });
      // FE posterior (2021 → 2027): la regla del PO es preservar lo anclado, no extender.
      await store.persistDecoded(DOC_ID, decoded('2021-06-01', '2027-06-01'));
      const { fecha, retention } = await readDates(DOC_ID);
      expect(retention).toBe('2026-01-15');
      expect(fecha).toBe('2020-01-15');
    });
  });
});
