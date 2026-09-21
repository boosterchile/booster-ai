import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };
let providedContext: Ctx = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useParams: () => ({ id: 'asg-chat-1' }),
}));

vi.mock('../components/chat/ChatPanel.js', () => ({
  ChatPanel: (props: { assignmentId: string; title?: string }) => (
    <div
      data-testid="chat-panel"
      data-assignment-id={props.assignmentId}
      data-title={props.title}
    />
  ),
}));

const { ChatViajeRoute } = await import('./chat-viaje.js');

function makeMe(): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'F' } as MeOnboarded['user'],
    memberships: [],
    active_membership: null,
  } as MeOnboarded;
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatViajeRoute — deep-link WA/push', () => {
  it('no onboarded → no monta ChatPanel', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ChatViajeRoute />
      </Wrapper>,
    );
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  it('onboarded → ChatPanel con el assignmentId de la URL', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ChatViajeRoute />
      </Wrapper>,
    );
    const panel = screen.getByTestId('chat-panel');
    expect(panel).toHaveAttribute('data-assignment-id', 'asg-chat-1');
    expect(screen.getByRole('link', { name: 'Volver' })).toBeInTheDocument();
  });
});
