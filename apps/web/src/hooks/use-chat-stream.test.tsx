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

// fix-sse-ticket-auth: el hook ahora hace POST /stream-ticket (Bearer) y abre
// el EventSource con ?ticket=. Mock del fetch del ticket.
const fetchMock = vi.fn(
  async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
    ok: true,
    status: 200,
    json: async () => ({ ticket: 'ticket-xyz', expires_in_sec: 60 }),
  }),
);

beforeEach(() => {
  lastEventSource = null;
  currentUserState.value = { getIdToken: getIdTokenMock };
  getIdTokenMock.mockClear();
  fetchMock.mockClear();
  (globalThis as any).EventSource = StubEventSource;
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis as any, 'EventSource');
  Reflect.deleteProperty(globalThis as any, 'fetch');
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
    // El token NUNCA va en la URL — solo el ticket efímero (fix-sse-ticket-auth).
    expect(lastEventSource?.url).toContain('ticket=ticket-xyz');
    expect(lastEventSource?.url).not.toContain('auth=');
    expect(lastEventSource?.url).not.toContain('firebase-id-token');
    // El ticket se pidió por POST con Bearer header (token NO en la URL).
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/assignments/a1/messages/stream-ticket'),
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer firebase-id-token' },
      }),
    );

    lastEventSource?.emit('connected');
    expect(onConnect).toHaveBeenCalled();

    lastEventSource?.emit('message', { message_id: 'm1', assignment_id: 'a1' });
    expect(onMessage).toHaveBeenCalledWith({ message_id: 'm1', assignment_id: 'a1' });
  });

  it('fallo al obtener el ticket → no abre EventSource + onDisconnect (reconnect)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'realtime_disabled' }),
    });
    const onDisconnect = vi.fn();
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage: vi.fn(), onDisconnect }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalled());
    expect(lastEventSource).toBeNull();
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

  it('reconnect tras onerror pide un ticket NUEVO (single-use) — SC-4', async () => {
    renderHook(() => useChatStream({ assignmentId: 'a1', onMessage: vi.fn() }));
    await waitFor(() => expect(lastEventSource).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1); // primer mint
    lastEventSource?.onerror?.();
    // El backoff reagenda connect → debe pedir OTRO ticket (el anterior ya se
    // consumió). Esperamos a que el segundo mint ocurra.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
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
