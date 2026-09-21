/**
 * Predicados y payload del seed T2 conductor E2E.
 *
 * Extraído de `seed-conductor-e2e.ts` para poder testear sin tocar
 * Firebase ni Postgres: abort prod/staging, leftovers activos del
 * conductor T2 que no son el viaje E2E de esta corrida.
 */
export const ACTIVE_ASSIGNMENT_STATUSES = ['asignado', 'recogido'] as const;

export type ActiveAssignmentStatus = (typeof ACTIVE_ASSIGNMENT_STATUSES)[number];

export type LeftoverAssignmentRow = {
  driverUserId: string | null;
  status: string;
  tripId: string;
  trackingCode: string;
};

export type LeftoverContext = {
  conductorUserId: string;
  /** Viaje E2E de esta corrida. Ausente = todavía no se insertó. */
  keepTripId?: string;
};

export type LeftoverCancellationPatch = {
  status: 'cancelado';
  cancelledAt: Date;
  cancelledByActor: 'admin_plataforma';
  cancellationReason: string;
  updatedAt: Date;
};

const LEFTOVER_REASON = 'seed e2e: leftover activo del conductor T2 (no viaje E2E de esta corrida)';

export function redactDatabaseUrl(url: string): string {
  return url.replace(/:[^:@]*@/, ':***@');
}

export function looksLikeProdOrStagingDatabaseUrl(url: string): boolean {
  return /prod|staging/i.test(url);
}

export function requireSafeDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      'DATABASE_URL (o TEST_DATABASE_URL) no está definido. El seed T2 no corre contra una URL implícita.',
    );
  }
  if (looksLikeProdOrStagingDatabaseUrl(url)) {
    throw new Error(`DATABASE_URL parece prod/staging. Aborto. URL: ${redactDatabaseUrl(url)}`);
  }
  return url;
}

export function isActiveAssignmentStatus(status: string): status is ActiveAssignmentStatus {
  return (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * True si la asignación está activa para el conductor T2 y no pertenece
 * al viaje E2E de esta corrida (`keepTripId`). El dashboard lista
 * `asignado|recogido`; esas son las que flakean el Playwright.
 */
export function isLeftoverActiveAssignment(
  row: LeftoverAssignmentRow,
  ctx: LeftoverContext,
): boolean {
  if (row.driverUserId !== ctx.conductorUserId) {
    return false;
  }
  if (!isActiveAssignmentStatus(row.status)) {
    return false;
  }
  if (ctx.keepTripId !== undefined && row.tripId === ctx.keepTripId) {
    return false;
  }
  return true;
}

export function leftoverCancellationPatch(now: Date): LeftoverCancellationPatch {
  return {
    status: 'cancelado',
    cancelledAt: now,
    cancelledByActor: 'admin_plataforma',
    cancellationReason: LEFTOVER_REASON,
    updatedAt: now,
  };
}
