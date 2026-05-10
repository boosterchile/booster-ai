import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @google-cloud/pubsub: no queremos abrir conexiones reales.
const publishMessageMock = vi.fn();
const closeMock = vi.fn(async () => undefined);
const deleteMock = vi.fn(async () => undefined);
const createSubscriptionMock = vi.fn(async () => [{ close: closeMock, delete: deleteMock }]);
const topicMock = vi.fn(() => ({
  publishMessage: publishMessageMock,
  createSubscription: createSubscriptionMock,
}));

vi.mock('@google-cloud/pubsub', () => ({
  PubSub: class {
    topic = topicMock;
  },
}));

const { createEphemeralChatSubscription, publishChatMessage } = await import(
  '../../src/services/chat-pubsub.js'
);

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('publishChatMessage', () => {
  it('publica con attributes assignment_id', async () => {
    publishMessageMock.mockResolvedValueOnce('msg-id-1');
    await publishChatMessage({
      topicName: 'chat-messages',
      logger: noopLogger,
      assignmentId: 'assign-1',
      messageId: 'msg-1',
    });
    expect(topicMock).toHaveBeenCalledWith('chat-messages');
    const call = publishMessageMock.mock.calls[0]?.[0] as {
      attributes: Record<string, string>;
      data: Buffer;
    };
    expect(call.attributes).toEqual({ assignment_id: 'assign-1' });
    const decoded = JSON.parse(call.data.toString());
    expect(decoded).toEqual({ message_id: 'msg-1', assignment_id: 'assign-1' });
  });

  it('falla del Pub/Sub no propaga error (fire-and-forget)', async () => {
    publishMessageMock.mockRejectedValueOnce(new Error('pubsub down'));
    await expect(
      publishChatMessage({
        topicName: 'chat-messages',
        logger: noopLogger,
        assignmentId: 'assign-1',
        messageId: 'msg-1',
      }),
    ).resolves.toBeUndefined();
    expect(noopLogger.error).toHaveBeenCalled();
  });
});

describe('createEphemeralChatSubscription', () => {
  it('crea subscription con filter assignment_id + TTL 24h', async () => {
    const { cleanup } = await createEphemeralChatSubscription({
      topicName: 'chat-messages',
      logger: noopLogger,
      assignmentId: 'assign-9',
    });
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
    const args = createSubscriptionMock.mock.calls[0];
    expect(args?.[0]).toMatch(/^chat-sse-assign-9-/);
    expect(args?.[1]).toEqual(
      expect.objectContaining({
        filter: 'attributes.assignment_id = "assign-9"',
        expirationPolicy: { ttl: { seconds: 86400 } },
        ackDeadlineSeconds: 10,
        retainAckedMessages: false,
      }),
    );
    expect(typeof cleanup).toBe('function');
  });

  it('cleanup() cierra y borra la subscription', async () => {
    const { cleanup } = await createEphemeralChatSubscription({
      topicName: 'chat-messages',
      logger: noopLogger,
      assignmentId: 'a1',
    });
    await cleanup();
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('cleanup error no propaga (TTL fallback)', async () => {
    deleteMock.mockRejectedValueOnce(new Error('not found'));
    const { cleanup } = await createEphemeralChatSubscription({
      topicName: 'chat-messages',
      logger: noopLogger,
      assignmentId: 'a2',
    });
    await expect(cleanup()).resolves.toBeUndefined();
    expect(noopLogger.warn).toHaveBeenCalled();
  });
});
