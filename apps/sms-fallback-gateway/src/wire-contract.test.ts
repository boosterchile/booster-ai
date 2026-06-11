import { telemetryRecordMessageSchema } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import { buildWireFromBstr } from './wire.js';

/**
 * TEST DE CONTRATO (espejo del de telemetry-tcp-gateway): el wire del
 * path SMS DEBE parsear con el schema canónico que valida el processor.
 * Si esto se pone rojo: actualizar shared-schemas y el processor ANTES
 * de deployar este gateway — un drift acá descarta eventos de PÁNICO en
 * silencio (el consumer ack-ea malformados).
 */
describe('contrato wire sms-fallback → telemetry-events → processor', () => {
  it('payload BSTR (GnssJamming) cumple el contrato', () => {
    const body = buildWireFromBstr({
      imei: '356307042441013',
      timestampMs: 1700000000000,
      latitude: -33.4372,
      longitude: -70.6506,
      speedKmh: 0,
      avlId: 318,
      rawValue: 2,
    });
    const parsed = telemetryRecordMessageSchema.parse(JSON.parse(JSON.stringify(body)));
    expect(parsed.vehicleId).toBeNull();
    expect(parsed.record.priority).toBe(2);
    expect(parsed.record.io.entries[0]?.id).toBe(318);
  });

  it('payload Unplug (252) también cumple', () => {
    const body = buildWireFromBstr({
      imei: '356307042441099',
      timestampMs: 1700000099000,
      latitude: -36.82,
      longitude: -73.04,
      speedKmh: 12.5,
      avlId: 252,
      rawValue: 1,
    });
    expect(() =>
      telemetryRecordMessageSchema.parse(JSON.parse(JSON.stringify(body))),
    ).not.toThrow();
  });
});
