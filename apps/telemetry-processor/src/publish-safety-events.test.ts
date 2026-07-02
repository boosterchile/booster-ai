import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import { publishSafetyEvent } from './publish-safety-events.js';

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}
const ev: SafetyEvent = {
  eventType: 'unplug',
  imei: '863238075489155',
  occurredAt: '2026-06-15T14:32:00.000Z',
};

describe('publishSafetyEvent', () => {
  it('publica con data JSON + attributes imei/event_type', async () => {
    const publishMessage = vi.fn().mockResolvedValue('msg-1');
    const topic = vi.fn().mockReturnValue({ publishMessage });
    await publishSafetyEvent({
      topicName: 'safety-p0',
      event: ev,
      logger: fakeLogger(),
      pubsub: { topic } as never,
    });
    expect(topic).toHaveBeenCalledWith('safety-p0');
    const arg = publishMessage.mock.calls[0]?.[0];
    expect(JSON.parse(arg.data.toString())).toMatchObject({
      eventType: 'unplug',
      imei: '863238075489155',
    });
    expect(arg.attributes).toEqual({ imei: '863238075489155', event_type: 'unplug' });
  });

  it('no lanza si Pub/Sub falla (fire-and-forget) y loguea error', async () => {
    const publishMessage = vi.fn().mockRejectedValue(new Error('pubsub down'));
    const topic = vi.fn().mockReturnValue({ publishMessage });
    const logger = fakeLogger();
    await expect(
      publishSafetyEvent({ topicName: 'safety-p0', event: ev, logger, pubsub: { topic } as never }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('no publica si topicName está vacío', async () => {
    const topic = vi.fn();
    await publishSafetyEvent({
      topicName: '',
      event: ev,
      logger: fakeLogger(),
      pubsub: { topic } as never,
    });
    expect(topic).not.toHaveBeenCalled();
  });
});
