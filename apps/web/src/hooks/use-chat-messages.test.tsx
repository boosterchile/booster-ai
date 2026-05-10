import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchChatMessagesMock = vi.fn();
const markChatReadMock = vi.fn();
vi.mock('../lib/chat-api.js', () => ({
  fetchChatMessages: fetchChatMessagesMock,
  markChatRead: markChatReadMock,
}));

let chatStreamOpts: {
  assignmentId: string | null;
  onMessage: (msg: { message_id: string; assignment_id: string }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
} | null = null;
vi.mock('./use-chat-stream.js', () => ({
  useChatStream: (opts: typeof chatStreamOpts) => {
    chatStreamOpts = opts;
  },
}));

const { useChatMessages } = await import('./use-chat-messages.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  chatStreamOpts = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const PAGE_1 = {
  messages: [
    { id: 'm2', body: 'hola 2', created_at: '2026-05-10T10:01:00Z', sender_role: 'shipper' },
    { id: 'm1', body: 'hola 1', created_at: '2026-05-10T10:00:00Z', sender_role: 'carrier' },
  ],
  next_cursor: 'cursor-page-2',
  viewer_role: 'carrier',
};
const PAGE_2 = {
  messages: [
    { id: 'm0', body: 'mas viejo', created_at: '2026-05-10T09:59:00Z', sender_role: 'shipper' },
  ],
  next_cursor: null,
  viewer_role: 'carrier',
};

describe('useChatMessages — query', () => {
  it('enabled=true (default) → fetch página inicial sin cursor', async () => {
    fetchChatMessagesMock.mockResolvedValueOnce(PAGE_1);
    markChatReadMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchChatMessagesMock).toHaveBeenCalledWith({ assignmentId: 'a1', limit: 50 });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.viewerRole).toBe('carrier');
    expect(result.current.hasMore).toBe(true);
  });

  it('enabled=false → no fetch + no SSE habilitado', () => {
    renderHook(() => useChatMessages('a1', { enabled: false }), { wrapper: makeWrapper() });
    expect(fetchChatMessagesMock).not.toHaveBeenCalled();
    expect(chatStreamOpts?.assignmentId).toBeNull();
  });

  it('viewerRole=null inicialmente (sin data)', () => {
    fetchChatMessagesMock.mockImplementation(() => new Promise<never>(() => undefined));
    const { result } = renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    expect(result.current.viewerRole).toBeNull();
    expect(result.current.messages).toEqual([]);
  });
});

describe('useChatMessages — loadMore', () => {
  it('loadMore → fetch siguiente página con cursor', async () => {
    fetchChatMessagesMock.mockResolvedValueOnce(PAGE_1).mockResolvedValueOnce(PAGE_2);
    const { result } = renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(fetchChatMessagesMock).toHaveBeenCalledWith({
      assignmentId: 'a1',
      cursor: 'cursor-page-2',
      limit: 50,
    });
    expect(result.current.hasMore).toBe(false);
  });

  it('loadMore sin hasNextPage → no-op', async () => {
    fetchChatMessagesMock.mockResolvedValueOnce({ ...PAGE_1, next_cursor: null });
    const { result } = renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    fetchChatMessagesMock.mockClear();
    await act(async () => {
      result.current.loadMore();
    });
    expect(fetchChatMessagesMock).not.toHaveBeenCalled();
  });
});

describe('useChatMessages — SSE wired', () => {
  it('onConnect del stream → isLive=true', async () => {
    fetchChatMessagesMock.mockResolvedValueOnce(PAGE_1);
    const { result } = renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(chatStreamOpts).not.toBeNull());
    act(() => {
      chatStreamOpts?.onConnect?.();
    });
    expect(result.current.isLive).toBe(true);
  });

  it('onDisconnect → isLive=false', async () => {
    fetchChatMessagesMock.mockResolvedValueOnce(PAGE_1);
    const { result } = renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(chatStreamOpts).not.toBeNull());
    act(() => {
      chatStreamOpts?.onConnect?.();
      chatStreamOpts?.onDisconnect?.();
    });
    expect(result.current.isLive).toBe(false);
  });

  it('onMessage del stream → invalida query y dispara markRead', async () => {
    fetchChatMessagesMock.mockResolvedValue(PAGE_1);
    markChatReadMock.mockResolvedValue(undefined);
    renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(chatStreamOpts).not.toBeNull());
    await waitFor(() => expect(markChatReadMock).toHaveBeenCalled());
    markChatReadMock.mockClear();
    fetchChatMessagesMock.mockClear();
    act(() => {
      chatStreamOpts?.onMessage({ message_id: 'm9', assignment_id: 'a1' });
    });
    await waitFor(() => expect(fetchChatMessagesMock).toHaveBeenCalled());
    expect(markChatReadMock).toHaveBeenCalled();
  });
});

describe('useChatMessages — markRead inicial', () => {
  it('al recibir primera page → markRead se dispara una vez', async () => {
    fetchChatMessagesMock.mockResolvedValueOnce(PAGE_1);
    markChatReadMock.mockResolvedValue(undefined);
    renderHook(() => useChatMessages('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(markChatReadMock).toHaveBeenCalledTimes(1));
  });

  it('enabled=false → no markRead', async () => {
    renderHook(() => useChatMessages('a1', { enabled: false }), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 30));
    expect(markChatReadMock).not.toHaveBeenCalled();
  });
});
