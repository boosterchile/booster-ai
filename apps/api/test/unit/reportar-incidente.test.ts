import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INCIDENT_TYPES,
  isIncidentType,
  reportarIncidente,
} from '../../src/services/reportar-incidente.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<typeof reportarIncidente>[0]['logger'];

const ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000c01';
const TRIP_ID = '00000000-0000-0000-0000-000000000c02';
const EMPRESA_ID = '00000000-0000-0000-0000-000000000c03';
const USER_ID = '00000000-0000-0000-0000-000000000c04';
const TRIP_EVENT_ID = '00000000-0000-0000-0000-000000000c05';

interface AssignmentRow {
  id: string;
  tripId: string;
  empresaId: string;
}

function makeDbStub(opts: {
  assignmentRow?: AssignmentRow | null;
  insertReturning?: { id: string; recordedAt: Date }[];
}) {
  const limitFn = vi.fn(() =>
    Promise.resolve(
      opts.assignmentRow === null ? [] : opts.assignmentRow ? [opts.assignmentRow] : [],
    ),
  );
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const insertReturning = opts.insertReturning ?? [
    { id: TRIP_EVENT_ID, recordedAt: new Date('2026-05-10T18:00:00Z') },
  ];
  const returningFn = vi.fn().mockResolvedValue(insertReturning);
  const valuesFn = vi.fn(() => ({ returning: returningFn }));
  const insertFn = vi.fn(() => ({ values: valuesFn }));

  return {
    db: {
      select: selectFn,
      insert: insertFn,
    } as unknown as Parameters<typeof reportarIncidente>[0]['db'],
    spies: { selectFn, insertFn, valuesFn, returningFn },
  };
}

const baseAssignment = (overrides: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: ASSIGNMENT_ID,
  tripId: TRIP_ID,
  empresaId: EMPRESA_ID,
  ...overrides,
});

describe('isIncidentType', () => {
  it('reconoce todos los tipos canónicos', () => {
    for (const t of INCIDENT_TYPES) {
      expect(isIncidentType(t)).toBe(true);
    }
  });

  it('rechaza string random', () => {
    expect(isIncidentType('foo')).toBe(false);
    expect(isIncidentType('')).toBe(false);
  });

  it('rechaza non-string', () => {
    expect(isIncidentType(null)).toBe(false);
    expect(isIncidentType(undefined)).toBe(false);
    expect(isIncidentType(123)).toBe(false);
    expect(isIncidentType({})).toBe(false);
  });
});

describe('reportarIncidente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assignment no existe → ok:false code=assignment_not_found', async () => {
    const { db } = makeDbStub({ assignmentRow: null });
    const result = await reportarIncidente({
      db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      input: {
        incidentType: 'demora',
        actor: { empresaId: EMPRESA_ID, userId: USER_ID },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('assignment_not_found');
    }
  });

  it('actor de otra empresa → ok:false code=forbidden_owner_mismatch', async () => {
    const { db, spies } = makeDbStub({
      assignmentRow: baseAssignment({ empresaId: 'otra-empresa' }),
    });
    const result = await reportarIncidente({
      db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      input: {
        incidentType: 'accidente',
        actor: { empresaId: EMPRESA_ID, userId: USER_ID },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('forbidden_owner_mismatch');
    }
    // No insert si forbidden.
    expect(spies.insertFn).not.toHaveBeenCalled();
  });

  it('happy path: persiste tripEvent con payload completo + retorna id', async () => {
    const { db, spies } = makeDbStub({
      assignmentRow: baseAssignment(),
    });
    const result = await reportarIncidente({
      db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      input: {
        incidentType: 'falla_mecanica',
        description: 'Pinchazo rueda trasera derecha',
        actor: { empresaId: EMPRESA_ID, userId: USER_ID },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tripEventId).toBe(TRIP_EVENT_ID);
    }

    // Verificar shape del INSERT.
    const valuesArg = spies.valuesFn.mock.calls[0]?.[0];
    expect(valuesArg).toMatchObject({
      tripId: TRIP_ID,
      assignmentId: ASSIGNMENT_ID,
      eventType: 'incidente_reportado',
      source: 'web',
      recordedByUserId: USER_ID,
    });
    expect(valuesArg.payload).toMatchObject({
      incident_type: 'falla_mecanica',
      description: 'Pinchazo rueda trasera derecha',
      actor_empresa_id: EMPRESA_ID,
      actor_user_id: USER_ID,
      reported_via: 'pwa',
    });
  });

  it('description opcional: payload.description = null si no viene', async () => {
    const { db, spies } = makeDbStub({
      assignmentRow: baseAssignment(),
    });
    await reportarIncidente({
      db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      input: {
        incidentType: 'otro',
        actor: { empresaId: EMPRESA_ID, userId: USER_ID },
      },
    });
    const valuesArg = spies.valuesFn.mock.calls[0]?.[0];
    expect(valuesArg.payload.description).toBeNull();
  });

  it('insert returning vacío → throw (defensivo, no debería pasar en prod)', async () => {
    const { db } = makeDbStub({
      assignmentRow: baseAssignment(),
      insertReturning: [],
    });
    await expect(
      reportarIncidente({
        db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        input: {
          incidentType: 'demora',
          actor: { empresaId: EMPRESA_ID, userId: USER_ID },
        },
      }),
    ).rejects.toThrow(/insert tripEvents returned no row/);
  });
});
