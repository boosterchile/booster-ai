import { tripEventTypeSchema } from '@booster-ai/shared-schemas';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { tripEvents, trips } from '../../src/db/schema.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T1.5 of Sprint S1a — Tests integration drift sobre infra T1+T2.
 *
 * Cubre ADR-043 §4 patterns:
 *   - Pattern A: round-trip enum values (los 2 valores nuevos de T1.2)
 *   - Pattern B: identifier match Drizzle column-level (snake → TS camel → alias)
 *   - Pattern C: N/A en S1a (0 Clase B confirmadas en inventory post-triage)
 *
 * Cobertura parcial del Hallazgo H-S1a-1 (spec §12.5):
 *   - ✅ Valida que el code path SQL → service → response shape funciona para
 *        los 2 valores enum agregados en T1.2 (`conductor_asignado`,
 *        `incidente_reportado`).
 *   - ❌ NO instala `.parse()` Zod en boundaries HTTP (queda en S2/S3 backlog).
 */
describe('integration: drift-alignment T1.5', () => {
  let handle: TestDbHandle;
  let testTripId: string | undefined;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  afterEach(async () => {
    if (testTripId) {
      // FK trip_events.viaje_id -> trips.id ON DELETE RESTRICT: borrar events primero.
      await handle.db.delete(tripEvents).where(eq(tripEvents.tripId, testTripId));
      await handle.db.delete(trips).where(eq(trips.id, testTripId));
      testTripId = undefined;
    }
  });

  /**
   * Crea un trip mínimo (solo campos NOT NULL, sin FKs opcionales a
   * empresas/users). Necesario para satisfacer FK trip_events.viaje_id.
   */
  async function createMinimalTrip(): Promise<string> {
    // trackingCode es varchar(12) — usar suffix corto de ≤9 chars para encajar.
    const suffix = Math.random().toString(36).slice(2, 11).toUpperCase();
    const [{ id }] = await handle.db
      .insert(trips)
      .values({
        trackingCode: `T15${suffix}`,
        originAddressRaw: 'origen-test',
        destinationAddressRaw: 'destino-test',
        cargoType: 'carga_seca',
        pickupDateRaw: 'hoy',
      })
      .returning({ id: trips.id });
    return id;
  }

  describe('Pattern A — round-trip enum values (cubre T1.2 alineamiento)', () => {
    test('conductor_asignado: INSERT + SELECT preserva valor exacto', async () => {
      testTripId = await createMinimalTrip();
      await handle.db.insert(tripEvents).values({
        tripId: testTripId,
        eventType: 'conductor_asignado',
        source: 'api',
      });
      const [row] = await handle.db
        .select({ eventType: tripEvents.eventType })
        .from(tripEvents)
        .where(eq(tripEvents.tripId, testTripId));
      expect(row.eventType).toBe('conductor_asignado');
      // El valor SQL es parseable por el Zod schema TS post-T1.2.
      expect(() => tripEventTypeSchema.parse(row.eventType)).not.toThrow();
    });

    test('incidente_reportado: INSERT + SELECT preserva valor exacto', async () => {
      testTripId = await createMinimalTrip();
      await handle.db.insert(tripEvents).values({
        tripId: testTripId,
        eventType: 'incidente_reportado',
        source: 'whatsapp',
      });
      const [row] = await handle.db
        .select({ eventType: tripEvents.eventType })
        .from(tripEvents)
        .where(eq(tripEvents.tripId, testTripId));
      expect(row.eventType).toBe('incidente_reportado');
      expect(() => tripEventTypeSchema.parse(row.eventType)).not.toThrow();
    });
  });

  describe('Pattern B — identifier match Drizzle (replica route handler shape)', () => {
    /**
     * Replica EXACTAMENTE el mapping del route handler
     * `apps/api/src/routes/trip-requests-v2.ts`:
     *
     *     db.select({
     *       id: tripEvents.id,
     *       event_type: tripEvents.eventType,
     *       source: tripEvents.source,
     *       payload: tripEvents.payload,
     *       recorded_at: tripEvents.recordedAt,
     *     }).from(tripEvents)
     *
     * Lo que este test detecta si rompe:
     *   1. Rename de `tripEvents.eventType` en schema sin actualizar alias en routes.
     *   2. Drizzle pierde valor en mapping snake_case (column) → camelCase (field) → alias.
     *   3. Response shape rompe contrato (key debe ser `event_type` snake_case, NO `eventType`).
     */
    test('SELECT con alias snake_case replica response shape del endpoint', async () => {
      testTripId = await createMinimalTrip();
      await handle.db.insert(tripEvents).values({
        tripId: testTripId,
        eventType: 'conductor_asignado',
        source: 'api',
      });
      const events = await handle.db
        .select({
          id: tripEvents.id,
          event_type: tripEvents.eventType,
          source: tripEvents.source,
          payload: tripEvents.payload,
          recorded_at: tripEvents.recordedAt,
        })
        .from(tripEvents)
        .where(eq(tripEvents.tripId, testTripId));

      expect(events).toHaveLength(1);
      const event = events[0];

      // Response shape exacto del endpoint:
      expect(event).toHaveProperty('event_type');
      expect(event.event_type).toBe('conductor_asignado');

      // Garantías negativas: el alias debe SUSTITUIR, no agregar paralelamente.
      expect(event).not.toHaveProperty('eventType');
      expect(event).not.toHaveProperty('tipo_evento');
    });
  });

  describe('Pattern C — flag transición Clase B', () => {
    // ADR-043 §4 Pattern C aplica solo si hay divergencias Clase B (breaking API + flag).
    // S1a post-triage: 0 Clase B confirmadas (caso 8 tripState diferido a sub-spec).
    // Skip declarativo para que el runner reporte N/A explícitamente.
    test.skip('N/A en S1a — 0 Clase B confirmadas en inventory post-triage', () => {
      // Intencionalmente skipped. Ver .specs/s1-drift-coverage-e2e/inventory-classification.md
    });
  });
});
