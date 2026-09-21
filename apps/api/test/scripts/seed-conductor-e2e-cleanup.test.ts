import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  isLeftoverActiveAssignment,
  leftoverCancellationPatch,
  requireSafeDatabaseUrl,
} from '../../scripts/seed-conductor-e2e-cleanup.js';

const COND = 'user-cond-t2';
const KEEP = 'trip-e2e-esta-corrida';

describe('requireSafeDatabaseUrl', () => {
  it('exige URL explícita (no hay default implícito)', () => {
    expect(() => requireSafeDatabaseUrl(undefined)).toThrow(/DATABASE_URL/);
    expect(() => requireSafeDatabaseUrl('')).toThrow(/DATABASE_URL/);
  });

  it('aborta si la URL parece prod o staging', () => {
    expect(() =>
      requireSafeDatabaseUrl('postgresql://user:secret@prod-sql.example:5432/booster'),
    ).toThrow(/prod\/staging/);
    expect(() => requireSafeDatabaseUrl('postgresql://user:secret@cloudsql/staging-db')).toThrow(
      /prod\/staging/,
    );
  });

  it('redacta el password en el error de prod', () => {
    expect(() => requireSafeDatabaseUrl('postgresql://user:super-secret@prod-sql:5432/db')).toThrow(
      /:\*\*\*@/,
    );
    expect(() =>
      requireSafeDatabaseUrl('postgresql://user:super-secret@prod-sql:5432/db'),
    ).not.toThrow(/super-secret/);
  });

  it('acepta URLs locales / de CI', () => {
    expect(requireSafeDatabaseUrl('postgresql://test:test@localhost:5432/test')).toBe(
      'postgresql://test:test@localhost:5432/test',
    );
    expect(requireSafeDatabaseUrl('postgresql://test:test@127.0.0.1:5432/booster_dev')).toContain(
      '127.0.0.1',
    );
  });
});

describe('isLeftoverActiveAssignment', () => {
  it('ACTIVE_ASSIGNMENT_STATUSES son asignado y recogido (los que lista el dashboard)', () => {
    expect([...ACTIVE_ASSIGNMENT_STATUSES]).toEqual(['asignado', 'recogido']);
  });

  it('cancela asignado/recogido del conductor T2 que no es el viaje E2E de esta corrida', () => {
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: COND,
          status: 'asignado',
          tripId: 'trip-smoke-t2',
          trackingCode: 'BOO-SMOKE1',
        },
        { conductorUserId: COND, keepTripId: KEEP },
      ),
    ).toBe(true);
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: COND,
          status: 'recogido',
          tripId: 'trip-otro-e2e',
          trackingCode: 'E2EOLD99999',
        },
        { conductorUserId: COND, keepTripId: KEEP },
      ),
    ).toBe(true);
  });

  it('no toca el viaje E2E de esta corrida', () => {
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: COND,
          status: 'asignado',
          tripId: KEEP,
          trackingCode: 'E2ENEW12345',
        },
        { conductorUserId: COND, keepTripId: KEEP },
      ),
    ).toBe(false);
  });

  it('sin keepTripId, todas las activas del T2 son leftover (pre-insert del seed)', () => {
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: COND,
          status: 'asignado',
          tripId: KEEP,
          trackingCode: 'E2ENEW12345',
        },
        { conductorUserId: COND },
      ),
    ).toBe(true);
  });

  it('no toca entregado ni cancelado (terminales)', () => {
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: COND,
          status: 'entregado',
          tripId: 'trip-old',
          trackingCode: 'BOO-DONE',
        },
        { conductorUserId: COND },
      ),
    ).toBe(false);
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: COND,
          status: 'cancelado',
          tripId: 'trip-old',
          trackingCode: 'BOO-CANC',
        },
        { conductorUserId: COND },
      ),
    ).toBe(false);
  });

  it('no toca asignaciones de otro conductor', () => {
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: 'otro-cond',
          status: 'asignado',
          tripId: 'trip-x',
          trackingCode: 'BOO-OTRO',
        },
        { conductorUserId: COND },
      ),
    ).toBe(false);
    expect(
      isLeftoverActiveAssignment(
        {
          driverUserId: null,
          status: 'asignado',
          tripId: 'trip-x',
          trackingCode: 'BOO-NULL',
        },
        { conductorUserId: COND },
      ),
    ).toBe(false);
  });
});

describe('leftoverCancellationPatch', () => {
  it('marca cancelado con actor de plataforma y timestamp', () => {
    const now = new Date('2026-09-21T05:00:00.000Z');
    expect(leftoverCancellationPatch(now)).toEqual({
      status: 'cancelado',
      cancelledAt: now,
      cancelledByActor: 'admin_plataforma',
      cancellationReason:
        'seed e2e: leftover activo del conductor T2 (no viaje E2E de esta corrida)',
      updatedAt: now,
    });
  });
});
