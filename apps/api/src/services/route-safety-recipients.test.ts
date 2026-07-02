/**
 * Tests de routeSafetyRecipients (Task 8 — safety notification routing).
 *
 * Cubre:
 *   1. Vehicle found by vehicleId, active assignment → returns trackingCode + dueños.
 *   2. Vehicle found by imei (no vehicleId), no active assignment → trackingCode null, dueños returned.
 *   3. Vehicle not found → returns null.
 *   4. Empresa with multiple dueños → all returned.
 *   5. Dueño with null phone → phoneE164: null (still included as recipient).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import {
  type SafetyRecipient,
  type SafetyRouting,
  routeSafetyRecipients,
} from './route-safety-recipients.js';

// ---------------------------------------------------------------------------
// Helpers para construir el stub de Drizzle.
//
// La función hace DOS queries independientes con `.select().from().where()`:
//   Q1 — vehicle lookup
//   Q2 — active assignment + trip (joined)
//   Q3 — memberships innerJoin users (dueños)
//
// Cada query usa la misma cadena pero devuelve datos distintos.
// Usamos una queue de resultados: la primera llamada a `where` (o `on` / `limit`)
// devuelve el primer elemento de la cola, la segunda el segundo, etc.
// ---------------------------------------------------------------------------

type SelectResult = Record<string, unknown>[];

function makeDbStub(queue: SelectResult[]) {
  let callIndex = 0;

  const limit = vi.fn(async () => {
    const result = queue[callIndex] ?? [];
    callIndex += 1;
    return result;
  });

  // Para las queries sin .limit() al final (la de dueños no tiene limit)
  // necesitamos que .where() también resuelva. Creamos un objeto que tanto
  // es thenable (si se await directamente) como tiene .limit().
  function makeWhere(): Promise<SelectResult> & { limit: typeof limit } {
    const idx = callIndex;
    callIndex += 1;
    const p = Promise.resolve(queue[idx] ?? []) as Promise<SelectResult> & { limit: typeof limit };
    p.limit = vi.fn(async () => queue[idx] ?? []);
    return p;
  }

  // innerJoin devuelve un objeto con .where()
  const innerJoin = vi.fn(() => ({ where: vi.fn(makeWhere) }));

  // from devuelve objeto con .where() e .innerJoin()
  const from = vi.fn(() => ({
    where: vi.fn(makeWhere),
    innerJoin,
  }));

  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as unknown as Db,
  };
}

// Filas de vehículo de ejemplo
const vehicleRow = {
  id: 'v-uuid',
  empresaId: 'emp-uuid',
  plate: 'ABCD12',
  teltonikaImei: '351756051523010',
};

// Fila de assignment + trip (active: status 'asignado')
const assignmentRow = {
  status: 'asignado' as const,
  trackingCode: 'TRK-001',
};

// Fila de dueño
function makeDuenoRow(userId: string, phone: string | null) {
  return { userId, phoneE164: phone };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('routeSafetyRecipients', () => {
  it('vehicle found by vehicleId, active assignment → returns trackingCode + dueños', async () => {
    // Q1: vehicle lookup by id → 1 row
    // Q2: active assignment+trip → 1 row (status asignado)
    // Q3: dueños → 1 row
    const { db } = makeDbStub([
      [vehicleRow],
      [assignmentRow],
      [makeDuenoRow('user-1', '+56912345678')],
    ]);

    const result = await routeSafetyRecipients({
      db,
      imei: '351756051523010',
      vehicleId: 'v-uuid',
    });

    expect(result).not.toBeNull();
    const r = result as SafetyRouting;
    expect(r.empresaId).toBe('emp-uuid');
    expect(r.vehicleLabel).toBe('ABCD12');
    expect(r.trackingCode).toBe('TRK-001');
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0]).toEqual<SafetyRecipient>({
      userId: 'user-1',
      phoneE164: '+56912345678',
    });
  });

  it('vehicle found by imei (no vehicleId), no active assignment → trackingCode null, dueños returned', async () => {
    // Q1: vehicle lookup by imei → 1 row
    // Q2: active assignment+trip → empty (parked)
    // Q3: dueños → 1 row
    const { db } = makeDbStub([[vehicleRow], [], [makeDuenoRow('user-1', '+56912345678')]]);

    const result = await routeSafetyRecipients({
      db,
      imei: '351756051523010',
      // vehicleId NOT passed
    });

    expect(result).not.toBeNull();
    const r = result as SafetyRouting;
    expect(r.trackingCode).toBeNull();
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0]?.userId).toBe('user-1');
  });

  it('vehicle not found → returns null', async () => {
    // Q1: vehicle lookup → empty
    const { db } = makeDbStub([[]]);

    const result = await routeSafetyRecipients({
      db,
      imei: 'not-in-db',
    });

    expect(result).toBeNull();
  });

  it('empresa with multiple dueños → all returned', async () => {
    // Q1: vehicle → found
    // Q2: active assignment → found with trackingCode
    // Q3: dueños → 2 rows
    const { db } = makeDbStub([
      [vehicleRow],
      [assignmentRow],
      [makeDuenoRow('user-1', '+56911111111'), makeDuenoRow('user-2', '+56922222222')],
    ]);

    const result = await routeSafetyRecipients({
      db,
      imei: '351756051523010',
      vehicleId: 'v-uuid',
    });

    expect(result).not.toBeNull();
    const r = result as SafetyRouting;
    expect(r.recipients).toHaveLength(2);
    expect(r.recipients.map((rec) => rec.userId)).toEqual(['user-1', 'user-2']);
  });

  it('dueño with null phone → phoneE164: null (still a recipient)', async () => {
    // Q1: vehicle → found
    // Q2: active assignment → empty (parked)
    // Q3: dueño with null phone
    const { db } = makeDbStub([[vehicleRow], [], [makeDuenoRow('user-no-phone', null)]]);

    const result = await routeSafetyRecipients({
      db,
      imei: '351756051523010',
    });

    expect(result).not.toBeNull();
    const r = result as SafetyRouting;
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0]).toEqual<SafetyRecipient>({
      userId: 'user-no-phone',
      phoneE164: null,
    });
  });
});
