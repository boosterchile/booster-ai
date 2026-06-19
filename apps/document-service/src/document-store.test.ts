import type { IngestResult } from '@booster-ai/transport-documents';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { createDrizzleDocumentStore } from './document-store.js';

/**
 * Test directo de la capa SQL del worker TED (dominio crítico: retención legal
 * SII 6 años, O-3). No levanta Postgres: stubea `db.execute` capturando el
 * objeto `sql` de Drizzle y lo compila con `PgDialect` para inspeccionar el SQL
 * generado y sus binds. El foco es la INVARIANTE O-3: `persistDecoded` NUNCA
 * acorta una retención ya fijada.
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

  describe('persistDecoded — invariante O-3: NUNCA acortar la retención', () => {
    it('usa GREATEST(COALESCE(retention_until, nuevo), nuevo) — el plazo solo se mantiene o extiende', async () => {
      const { db, calls } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      await store.persistDecoded(DOC_ID, decoded('2026-06-11', '2032-06-11'));
      const q = calls[0];
      expect(q?.sql).toContain('GREATEST');
      expect(q?.sql).toContain('COALESCE(retention_until,');
      // El valor nuevo se cast a ::date (la columna es date, el bind es text).
      expect(q?.sql).toMatch(
        /GREATEST\(\s*COALESCE\(retention_until,\s*\$\d+::date\),\s*\$\d+::date\s*\)/,
      );
    });

    it('(a) fallback created_at+6a YA fijado + TED con fecha_emision anterior → NO se acorta (GREATEST conserva el mayor)', async () => {
      // El nuevo cálculo (fecha_emision 2020 + 6a = 2026) sería MENOR que el
      // fallback ya persistido (created_at 2026 + 6a = 2032). GREATEST garantiza
      // que el plazo persistido (2032) gana → no se acorta.
      const { db, calls } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      const nuevoCalculo = '2026-01-15'; // fecha_emision 2020 + 6a (más corto)
      await store.persistDecoded(DOC_ID, decoded('2020-01-15', nuevoCalculo));
      const q = calls[0];
      // Ambos operandos de GREATEST/COALESCE son el MISMO nuevo cálculo; el
      // existente (retention_until columna) entra vía COALESCE → max(existente, nuevo).
      expect(q?.sql).toContain('GREATEST');
      // El bind del nuevo cálculo aparece (dos veces por COALESCE + GREATEST).
      expect(q?.params.filter((p) => p === nuevoCalculo).length).toBe(2);
      // Crucialmente NO hay un set incondicional `retention_until = $n` plano.
      expect(q?.sql).not.toMatch(/retention_until = \$\d+::date,/);
    });

    it('(b) retention_until NULL + fecha_emision → COALESCE lo fija al nuevo (fecha_emision+6a)', async () => {
      const { db, calls } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      await store.persistDecoded(DOC_ID, decoded('2026-06-11', '2032-06-11'));
      const q = calls[0];
      // COALESCE(NULL, nuevo) = nuevo; GREATEST(nuevo, nuevo) = nuevo. El bind
      // del nuevo plazo está presente.
      expect(q?.params).toContain('2032-06-11');
      expect(q?.sql).toContain("extraction_status = 'decodificado'");
    });

    it('(c) sin fecha_emision (fallback) → mismo GREATEST/COALESCE, conserva el existente si es mayor', async () => {
      const { db, calls } = makeDbStub([{ rows: [] }]);
      const store = createDrizzleDocumentStore({ db, logger });
      // retentionUntil aquí es el fallback created_at+6a (needsReview=true).
      await store.persistDecoded(DOC_ID, decoded(null, '2032-06-18'));
      const q = calls[0];
      // fecha_emision se persiste como NULL (no había), pero la retención usa
      // la MISMA expresión que nunca acorta.
      expect(q?.sql).toContain('GREATEST');
      expect(q?.sql).toContain('COALESCE(retention_until,');
      expect(q?.params).toContain('2032-06-18');
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
});
