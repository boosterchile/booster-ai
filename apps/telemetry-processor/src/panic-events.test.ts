import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent, TelemetryRecordMessage } from '@booster-ai/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import { publishPanicEvents } from './panic-events.js';

type PublishFn = (a: { topicName: string; event: SafetyEvent; logger: Logger }) => Promise<void>;

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function makeMsg(
  entries: { id: number; value: number | string; byteSize?: 1 | 2 | 4 | 8 | null }[],
): TelemetryRecordMessage {
  return {
    imei: '863238075489155',
    vehicleId: null,
    record: {
      timestampMs: '1749998520000', // 2025-06-15T14:22:00.000Z
      priority: 1,
      gps: {
        longitude: -70.6506,
        latitude: -33.437,
        altitude: 567,
        angle: 45,
        satellites: 8,
        speedKmh: 60,
      },
      io: {
        eventIoId: 252,
        totalIo: entries.length,
        entries: entries.map((e) => ({ id: e.id, value: e.value, byteSize: e.byteSize ?? 1 })),
      },
    },
  };
}

describe('publishPanicEvents', () => {
  it('llama publish una vez con SafetyEvent unplug cuando AVL 252 = 1', async () => {
    const msg = makeMsg([{ id: 252, value: 1 }]);
    const publish = vi.fn<PublishFn>().mockResolvedValue(undefined);

    await publishPanicEvents({
      msg,
      topicName: 'safety-p0',
      logger: fakeLogger(),
      publish,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const called = publish.mock.calls[0]?.[0];
    expect(called?.topicName).toBe('safety-p0');
    expect(called?.event.eventType).toBe('unplug');
    expect(called?.event.imei).toBe('863238075489155');
    expect(called?.event.occurredAt).toBe(new Date(1749998520000).toISOString());
    expect(called?.event.rawValue).toBe(1);
  });

  it('no llama publish cuando no hay IO de pánico', async () => {
    // AVL 66 (velocidad) — no es pánico
    const msg = makeMsg([{ id: 66, value: 80 }]);
    const publish = vi.fn<PublishFn>().mockResolvedValue(undefined);

    await publishPanicEvents({
      msg,
      topicName: 'safety-p0',
      logger: fakeLogger(),
      publish,
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('llama publish una vez con SafetyEvent jamming cuando AVL 318 = 2', async () => {
    const msg = makeMsg([{ id: 318, value: 2 }]);
    const publish = vi.fn<PublishFn>().mockResolvedValue(undefined);

    await publishPanicEvents({
      msg,
      topicName: 'safety-p0',
      logger: fakeLogger(),
      publish,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const event = publish.mock.calls[0]?.[0]?.event;
    expect(event?.eventType).toBe('jamming');
    expect(event?.rawValue).toBe(2);
  });

  it('llama publish dos veces cuando hay Unplug Y GnssJamming en el mismo record', async () => {
    const msg = makeMsg([
      { id: 252, value: 1 },
      { id: 318, value: 1 },
    ]);
    const publish = vi.fn<PublishFn>().mockResolvedValue(undefined);

    await publishPanicEvents({
      msg,
      topicName: 'safety-p0',
      logger: fakeLogger(),
      publish,
    });

    expect(publish).toHaveBeenCalledTimes(2);
    const types = publish.mock.calls.map((c) => c[0]?.event.eventType);
    expect(types).toContain('unplug');
    expect(types).toContain('jamming');
  });
});
