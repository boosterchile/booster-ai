import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getIdTokenMock = vi.fn(async () => 'firebase-id-token');
const currentUserState: { value: { getIdToken: typeof getIdTokenMock } | null } = {
  value: { getIdToken: getIdTokenMock },
};
vi.mock('../lib/firebase.js', () => ({
  firebaseAuth: {
    get currentUser() {
      return currentUserState.value;
    },
  },
}));

const { useChatStream } = await import('./use-chat-stream.js');

interface FakeEventSource {
  url: string;
  listeners: Map<string, ((ev: MessageEvent) => void)[]>;
  onerror: (() => void) | null;
  closed: boolean;
  emit: (type: string, data?: unknown) => void;
  close: () => void;
}

let lastEventSource: FakeEventSource | null = null;

class StubEventSource implements FakeEventSource {
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    lastEventSource = this;
  }

  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  emit(type: string, data?: unknown) {
    const cbs = this.listeners.get(type) ?? [];
    for (const cb of cbs) {
      cb({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
    }
  }

  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  lastEventSource = null;
  currentUserState.value = { getIdToken: getIdTokenMock };
  getIdTokenMock.mockClear();
  (globalThis as any).EventSource = StubEventSource;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis as any, 'EventSource');
});

async function flushPromises() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('useChatStream', () => {
  it('enabled=false → no abre EventSource', async () => {
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage: vi.fn(), enabled: false }));
    await flushPromises();
    expect(lastEventSource).toBeNull();
  });

  it('assignmentId=null → no abre EventSource', async () => {
    renderHook(() => useChatStream({ assignmentId: null, onMessage: vi.fn() }));
    await flushPromises();
    expect(lastEventSource).toBeNull();
  });

  it('sin currentUser → no abre EventSource (timer agendado)', async () => {
    currentUserState.value = null;
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage: vi.fn() }));
    await flushPromises();
    expect(lastEventSource).toBeNull();
  });

  it('happy path: connect → onMessage parsea JSON y llama callback', async () => {
    const onMessage = vi.fn();
    const onConnect = vi.fn();
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage, onConnect }));
    await waitFor(() => expect(lastEventSource).not.toBeNull());
    expect(lastEventSource?.url).toContain('/assignments/a1/messages/stream');
    expect(lastEventSource?.url).toContain('auth=firebase-id-token');

    lastEventSource?.emit('connected');
    expect(onConnect).toHaveBeenCalled();

    lastEventSource?.emit('message', { message_id: 'm1', assignment_id: 'a1' });
    expect(onMessage).toHaveBeenCalledWith({ message_id: 'm1', assignment_id: 'a1' });
  });

  it('payload no-JSON → log warn, no crash, no callback', async () => {
    const onMessage = vi.fn();
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage }));
    await waitFor(() => expect(lastEventSource).not.toBeNull());
    lastEventSource?.emit('message', 'not-valid-json{');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('heartbeat → no-op (no llama onMessage)', async () => {
    const onMessage = vi.fn();
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage }));
    await waitFor(() => expect(lastEventSource).not.toBeNull());
    lastEventSource?.emit('heartbeat');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('onerror → close + onDisconnect (reconnect agendado con backoff)', async () => {
    const onDisconnect = vi.fn();
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage: vi.fn(), onDisconnect }));
    await waitFor(() => expect(lastEventSource).not.toBeNull());
    const first = lastEventSource;
    first?.onerror?.();
    expect(onDisconnect).toHaveBeenCalled();
    expect(first?.closed).toBe(true);
  });

  it('cleanup en unmount → close + cancela reconnect timer', async () => {
    const { unmount } = renderHook(() => useChatStream({ assignmentId: 'a1', onMessage: vi.fn() }));
    await waitFor(() => expect(lastEventSource).not.toBeNull());
    const es = lastEventSource;
    unmount();
    expect(es?.closed).toBe(true);
  });

  it('cambio de assignmentId → cierra el stream anterior y abre uno nuevo', async () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useChatStream({ assignmentId: id, onMessage: vi.fn() }),
      { initialProps: { id: 'a1' } },
    );
    await waitFor(() => expect(lastEventSource).not.toBeNull());
    const first = lastEventSource;
    expect(first?.url).toContain('/assignments/a1/');

    rerender({ id: 'a2' });
    await waitFor(() => expect(lastEventSource?.url).toContain('/assignments/a2/'));
    expect(first?.closed).toBe(true);
  });
});
