import { describe, expect, it, vi } from 'vitest';
import { resolveImei } from '../src/imei-auth.js';

function makeMockDb(opts: {
  vehicleRow?: { id: string };
  upsertedRow?: { id: string };
}) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: opts.vehicleRow ? [opts.vehicleRow] : [] })
    .mockResolvedValueOnce({ rows: opts.upsertedRow ? [opts.upsertedRow] : [] });
  // mock minimal de drizzle (noExplicitAny está off para tests)
  return { execute } as any;
}

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
  // minimal logger mock (noExplicitAny está off para tests)
} as any;

describe('resolveImei', () => {
  it('devuelve vehicleId si el IMEI matchea un vehículo registrado', async () => {
    const db = makeMockDb({ vehicleRow: { id: 'veh-uuid-123' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '356307042441013',
      sourceIp: '1.2.3.4',
    });
    expect(result.vehicleId).toBe('veh-uuid-123');
    expect(result.pendingDeviceId).toBeNull();
  });

  it('upsert en dispositivos_pendientes si IMEI no matchea', async () => {
    const db = makeMockDb({ upsertedRow: { id: 'pending-uuid-456' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '999999999999999',
      sourceIp: '5.6.7.8',
    });
    expect(result.vehicleId).toBeNull();
    expect(result.pendingDeviceId).toBe('pending-uuid-456');
  });

  it('maneja sourceIp null sin tirar', async () => {
    const db = makeMockDb({ upsertedRow: { id: 'pending-uuid-789' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '111111111111111',
      sourceIp: null,
    });
    expect(result.pendingDeviceId).toBe('pending-uuid-789');
  });
});
