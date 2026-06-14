import { telemetryRecordMessageSchema } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import { type RecordMessage, buildWireRecordMessage } from '../src/pubsub-publisher.js';

/**
 * TEST DE CONTRATO (spec refactor-contratos-canonicos §3): el body que el
 * gateway publica al topic `telemetry-events` DEBE parsear con el schema
 * canónico que el processor usa para validar al consumir. Antes el shape
 * vivía duplicado a mano y un drift producía descarte silencioso en prod
 * (el consumer ack-ea malformados) — auditoría 2026-06-09, riesgo alto.
 * Si este test se pone rojo: el wire cambió; actualizar
 * packages/shared-schemas/src/events/telemetry-record.ts y el processor
 * ANTES de deployar el gateway.
 */
describe('contrato wire gateway → telemetry-events → processor', () => {
  function makeMsg(overrides?: Partial<RecordMessage>): RecordMessage {
    return {
      imei: '356307042441013',
      vehicleId: '11111111-2222-3333-4444-555555555555',
      record: {
        timestampMs: 1700000000000n, // BigInt real, como sale del parser
        priority: 1,
        gps: {
          longitude: -70.6506,
          latitude: -33.4372,
          altitude: 540,
          angle: 180,
          satellites: 12,
          speedKmh: 85,
        },
        io: {
          eventIoId: 0,
          totalIo: 4,
          entries: [
            { id: 240, value: 1, byteSize: 1 },
            { id: 66, value: 12800, byteSize: 2 },
            // uint64 → BigInt (grupo N8) y Buffer (grupo NX de Codec 8E):
            // los dos casos que exigen serialización a string.
            { id: 16, value: 123456789012345n, byteSize: 8 },
            { id: 10358, value: Buffer.from([0xde, 0xad]), byteSize: null },
          ],
        },
      },
      ...overrides,
    };
  }

  it('el body serializado parsea con el schema canónico (BigInt y Buffer incluidos)', () => {
    const body = buildWireRecordMessage(makeMsg());
    // Round-trip por JSON como hace publishMessage (Buffer.from(JSON.stringify)).
    const wire = JSON.parse(JSON.stringify(body));
    const parsed = telemetryRecordMessageSchema.parse(wire);

    expect(parsed.record.timestampMs).toBe('1700000000000');
    expect(parsed.record.io.entries[2]?.value).toBe('123456789012345');
    expect(typeof parsed.record.io.entries[3]?.value).toBe('string'); // base64
  });

  it('vehicleId null (device pendiente / sms-fallback) también cumple el contrato', () => {
    const body = buildWireRecordMessage(makeMsg({ vehicleId: null }));
    const parsed = telemetryRecordMessageSchema.parse(JSON.parse(JSON.stringify(body)));
    expect(parsed.vehicleId).toBeNull();
  });
});
