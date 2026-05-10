import type { AvlPacket, AvlRecord } from '@booster-ai/codec8-parser';
import type { PubSub } from '@google-cloud/pubsub';
import { describe, expect, it, vi } from 'vitest';
import { CrashTracePublisher, TelemetryPublisher } from '../src/pubsub-publisher.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: noop,
  error: noop,
  fatal: noop,
  child: vi.fn(),
} as never;

interface TopicStub {
  publishMessage: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
}

function makePubSubStub(): { pubsub: PubSub; topic: TopicStub } {
  const topic: TopicStub = {
    publishMessage: vi.fn(async () => 'msg-id-123'),
    flush: vi.fn(async () => undefined),
  };
  const pubsub = { topic: vi.fn(() => topic) } as unknown as PubSub;
  return { pubsub, topic };
}

function recordWith(overrides: Partial<AvlRecord> = {}): AvlRecord {
  return {
    timestampMs: 1700000000000n,
    priority: 1,
    gps: {
      longitude: -70.65,
      latitude: -33.45,
      altitude: 540,
      angle: 180,
      satellites: 12,
      speedKmh: 85,
    },
    io: {
      eventIoId: 0,
      totalIo: 0,
      entries: [],
    },
    ...overrides,
  } as AvlRecord;
}

describe('TelemetryPublisher.publishRecord', () => {
  it('publica con attributes imei + vehicleId + priority + timestampMs', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new TelemetryPublisher(pubsub, 'telemetry-events', noopLogger);

    const id = await publisher.publishRecord({
      imei: '356307042441013',
      vehicleId: 'veh-1',
      record: recordWith({ priority: 2 }),
    });

    expect(id).toBe('msg-id-123');
    expect(topic.publishMessage).toHaveBeenCalledTimes(1);
    const call = topic.publishMessage.mock.calls[0]?.[0];
    expect(call.attributes).toEqual({
      imei: '356307042441013',
      vehicleId: 'veh-1',
      priority: '2',
      timestampMs: '1700000000000',
    });
  });

  it('serializa BigInt entries.value como string', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new TelemetryPublisher(pubsub, 'telemetry-events', noopLogger);

    await publisher.publishRecord({
      imei: 'i',
      vehicleId: null,
      record: recordWith({
        io: {
          eventIoId: 0,
          totalIo: 1,
          entries: [{ id: 240, value: 1234567890123n, byteSize: 8 }],
        },
      }) as AvlRecord,
    });

    const sent = JSON.parse((topic.publishMessage.mock.calls[0]?.[0].data as Buffer).toString());
    expect(sent.record.io.entries[0].value).toBe('1234567890123');
  });

  it('serializa Buffer entries.value como base64', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new TelemetryPublisher(pubsub, 'telemetry-events', noopLogger);

    await publisher.publishRecord({
      imei: 'i',
      vehicleId: 'v',
      record: recordWith({
        io: {
          eventIoId: 0,
          totalIo: 1,
          entries: [{ id: 256, value: Buffer.from([0xde, 0xad, 0xbe, 0xef]), byteSize: 4 }],
        },
      }) as AvlRecord,
    });

    const sent = JSON.parse((topic.publishMessage.mock.calls[0]?.[0].data as Buffer).toString());
    expect(sent.record.io.entries[0].value).toBe(
      Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64'),
    );
  });

  it('vehicleId null → attributes.vehicleId = "pending"', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new TelemetryPublisher(pubsub, 'telemetry-events', noopLogger);

    await publisher.publishRecord({ imei: 'i', vehicleId: null, record: recordWith() });

    expect(topic.publishMessage.mock.calls[0]?.[0].attributes.vehicleId).toBe('pending');
  });

  it('flush delega a topic.flush', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new TelemetryPublisher(pubsub, 'telemetry-events', noopLogger);
    await publisher.flush();
    expect(topic.flush).toHaveBeenCalledTimes(1);
  });
});

describe('CrashTracePublisher.publishCrashTrace', () => {
  function packetWith(records: AvlRecord[]): AvlPacket {
    return {
      codecId: 0x08,
      recordCount: records.length,
      records,
    } as AvlPacket;
  }

  it('publica el packet completo con attributes crashTraceVersion=1', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new CrashTracePublisher(pubsub, 'crash-traces', noopLogger);

    const id = await publisher.publishCrashTrace({
      imei: '356307042441013',
      vehicleId: 'veh-1',
      packet: packetWith([recordWith(), recordWith({ priority: 2 })]),
    });

    expect(id).toBe('msg-id-123');
    expect(topic.publishMessage).toHaveBeenCalledTimes(1);
    const call = topic.publishMessage.mock.calls[0]?.[0];
    expect(call.attributes).toEqual({
      imei: '356307042441013',
      vehicleId: 'veh-1',
      crashTraceVersion: '1',
    });
    const body = JSON.parse((call.data as Buffer).toString());
    expect(body.packet.recordCount).toBe(2);
    expect(body.packet.records).toHaveLength(2);
  });

  it('vehicleId null → attributes.vehicleId = "pending"', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new CrashTracePublisher(pubsub, 'crash-traces', noopLogger);

    await publisher.publishCrashTrace({
      imei: 'i',
      vehicleId: null,
      packet: packetWith([recordWith()]),
    });

    expect(topic.publishMessage.mock.calls[0]?.[0].attributes.vehicleId).toBe('pending');
  });

  it('serializa BigInt y Buffer entries de los records del packet', async () => {
    const { pubsub, topic } = makePubSubStub();
    const publisher = new CrashTracePublisher(pubsub, 'crash-traces', noopLogger);

    await publisher.publishCrashTrace({
      imei: 'i',
      vehicleId: 'v',
      packet: packetWith([
        recordWith({
          io: {
            eventIoId: 247,
            totalIo: 2,
            entries: [
              { id: 240, value: 999999999999n, byteSize: 8 },
              { id: 256, value: Buffer.from([0x01, 0x02]), byteSize: 2 },
            ],
          },
        }) as AvlRecord,
      ]),
    });

    const body = JSON.parse((topic.publishMessage.mock.calls[0]?.[0].data as Buffer).toString());
    expect(body.packet.records[0].io.entries[0].value).toBe('999999999999');
    expect(body.packet.records[0].io.entries[1].value).toBe(
      Buffer.from([0x01, 0x02]).toString('base64'),
    );
  });
});
