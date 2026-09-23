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
  eventIoId?: number,
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
        eventIoId: eventIoId ?? entries[0]?.id ?? 0,
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

  it('unplug de evento + jamming warning no avisa el warning', async () => {
    const msg = makeMsg(
      [
        { id: 252, value: 1 },
        { id: 318, value: 1 },
      ],
      252,
    );
    const publish = vi.fn<PublishFn>().mockResolvedValue(undefined);

    await publishPanicEvents({
      msg,
      topicName: 'safety-p0',
      logger: fakeLogger(),
      publish,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]?.event.eventType).toBe('unplug');
  });

  it('jamming warning (318=1) como evento no se publica al cliente', async () => {
    const msg = makeMsg([{ id: 318, value: 1 }], 318);
    const publish = vi.fn<PublishFn>().mockResolvedValue(undefined);

    await publishPanicEvents({
      msg,
      topicName: 'safety-p0',
      logger: fakeLogger(),
      publish,
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('IO pegado en un punto periódico (eventIoId 0) no se publica', async () => {
    const msg = makeMsg(
      [
        { id: 252, value: 1 },
        { id: 318, value: 2 },
      ],
      0,
    );
    const publish = vi.fn<PublishFn>().mockResolvedValue(undefined);

    await publishPanicEvents({
      msg,
      topicName: 'safety-p0',
      logger: fakeLogger(),
      publish,
    });

    expect(publish).not.toHaveBeenCalled();
  });
});
