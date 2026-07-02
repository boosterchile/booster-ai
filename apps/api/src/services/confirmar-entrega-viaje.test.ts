import { getTableName } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

// Mockeamos los side-effects post-commit (cert, scoring, coaching, liquidación,
// factor matching) — sus propios tests los cubren. Acá solo validamos la
// precondición de cierre flexible documental (F4-4a) dentro de la tx.
vi.mock('../services/emitir-certificado-viaje.js', () => ({
  emitirCertificadoViaje: vi.fn(async () => ({ skipped: true, reason: 'test' })),
}));
vi.mock('./emitir-certificado-viaje.js', () => ({
  emitirCertificadoViaje: vi.fn(async () => ({ skipped: true, reason: 'test' })),
}));
vi.mock('./calcular-metricas-viaje.js', () => ({
  recalcularNivelPostEntrega: vi.fn(async () => undefined),
}));
vi.mock('./actualizar-factor-matching.js', () => ({
  actualizarFactorMatchingViaje: vi.fn(async () => undefined),
}));
vi.mock('./calcular-score-conduccion-viaje.js', () => ({
  calcularScoreConduccionViaje: vi.fn(async () => undefined),
}));
vi.mock('./generar-coaching-viaje.js', () => ({
  generarCoachingViaje: vi.fn(async () => undefined),
}));
vi.mock('./liquidar-trip.js', () => ({ liquidarTrip: vi.fn(async () => ({ status: 'skipped' })) }));

const { confirmarEntregaViaje } = await import('./confirmar-entrega-viaje.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const TRIP_ID = 'b3b8c1d2-0000-4000-8000-000000000010';
const SHIPPER_EMP = 'b3b8c1d2-0000-4000-8000-000000000020';
const USER_ID = 'b3b8c1d2-0000-4000-8000-000000000030';
const ASSIGN_ID = 'b3b8c1d2-0000-4000-8000-000000000040';

const corte = new Date('2026-06-18T00:00:00.000Z');

/**
 * Fake tx que responde a la secuencia de selects del service:
 *   1. trips (id/status/createdAt/generadorCargaEmpresaId)  [.limit con .for('update')]
 *   2. assignments (id/empresaId/deliveredAt)               [.limit]
 *   3. documentos_transporte (extractionStatus)             [sin .limit — devuelve array directo]
 * y captura los UPDATE/INSERT.
 */
function makeDb(opts: {
  tripStatus: string;
  tripCreatedAt: Date;
  documentos: Array<{ extractionStatus: string }>;
}) {
  const updates: unknown[] = [];

  const tx = {
    select: vi.fn((_cols?: unknown) => {
      const chain: Record<string, unknown> = {};
      let table: 'trips' | 'assignments' | 'docs' | 'unknown' = 'unknown';
      chain.from = vi.fn((t: unknown) => {
        let name: string | undefined;
        try {
          name = getTableName(t as Parameters<typeof getTableName>[0]);
        } catch {
          name = undefined;
        }
        if (name === 'viajes') {
          table = 'trips';
        } else if (name === 'asignaciones') {
          table = 'assignments';
        } else if (name === 'documentos_transporte') {
          table = 'docs';
        }
        return chain;
      });
      const rowsFor = (): unknown[] => {
        if (table === 'trips') {
          return [
            {
              id: TRIP_ID,
              status: opts.tripStatus,
              createdAt: opts.tripCreatedAt,
              generadorCargaEmpresaId: SHIPPER_EMP,
            },
          ];
        }
        if (table === 'assignments') {
          return [{ id: ASSIGN_ID, empresaId: SHIPPER_EMP, deliveredAt: null }];
        }
        if (table === 'docs') {
          return opts.documentos;
        }
        return [];
      };
      chain.where = vi.fn(() => chain);
      // El chain es thenable: `await select().from().where()` (docs query, sin
      // .limit) resuelve aquí; las demás encadenan .limit()/.for('update').
      chain.then = (resolve: (rows: unknown[]) => void) => resolve(rowsFor());
      // .limit() devuelve un sub-chain thenable que además expone .for('update')
      // (trips usa .where().limit(1).for('update'); assignments usa .where().limit(1)).
      chain.limit = vi.fn(() => {
        const limited: Record<string, unknown> = {
          then: (resolve: (rows: unknown[]) => void) => resolve(rowsFor()),
          for: vi.fn(() => ({
            then: (resolve: (rows: unknown[]) => void) => resolve(rowsFor()),
          })),
        };
        return limited;
      });
      return chain;
    }),
    update: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.set = vi.fn((v: unknown) => {
        updates.push(v);
        return chain;
      });
      chain.where = vi.fn(() => chain);
      chain.returning = vi.fn(async () => [{ id: TRIP_ID }]);
      return chain;
    }),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  };

  const db = {
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    // post-commit select de assignment para liquidación
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: ASSIGN_ID }]) })),
      })),
    })),
  };

  return { db: db as never, updates };
}

const baseArgs = {
  logger,
  tripId: TRIP_ID,
  source: 'shipper' as const,
  actor: { empresaId: SHIPPER_EMP, userId: USER_ID },
  config: {},
};

describe('confirmarEntregaViaje — cierre flexible documental (F4-4a)', () => {
  it('sin documentClosePolicy: cierra sin precondición (backward-compat)', async () => {
    const { db } = makeDb({ tripStatus: 'asignado', tripCreatedAt: corte, documentos: [] });
    const r = await confirmarEntregaViaje({ ...baseArgs, db });
    expect(r.ok).toBe(true);
  });

  it('flag ON + orden nueva + 0 docs → rechaza con documento_requerido', async () => {
    const { db } = makeDb({
      tripStatus: 'asignado',
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [],
    });
    const r = await confirmarEntregaViaje({
      ...baseArgs,
      db,
      documentClosePolicy: {
        requireDocumentToClose: true,
        requireTedDecode: false,
        requireDocumentSince: corte,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('documento_requerido');
    }
  });

  it('flag ON + orden nueva + 1 doc pendiente → cierra (TED no requerido)', async () => {
    const { db } = makeDb({
      tripStatus: 'asignado',
      tripCreatedAt: new Date('2026-06-20T00:00:00.000Z'),
      documentos: [{ extractionStatus: 'pendiente' }],
    });
    const r = await confirmarEntregaViaje({
      ...baseArgs,
      db,
      documentClosePolicy: {
        requireDocumentToClose: true,
        requireTedDecode: false,
        requireDocumentSince: corte,
      },
    });
    expect(r.ok).toBe(true);
  });

  it('flag ON + orden legacy (antes del corte) + 0 docs → cierra (exenta)', async () => {
    const { db } = makeDb({
      tripStatus: 'asignado',
      tripCreatedAt: new Date('2026-06-01T00:00:00.000Z'),
      documentos: [],
    });
    const r = await confirmarEntregaViaje({
      ...baseArgs,
      db,
      documentClosePolicy: {
        requireDocumentToClose: true,
        requireTedDecode: false,
        requireDocumentSince: corte,
      },
    });
    expect(r.ok).toBe(true);
  });
});
