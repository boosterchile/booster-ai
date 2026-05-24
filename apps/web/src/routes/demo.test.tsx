import { DEFAULT_SITE_CONFIG } from '@booster-ai/shared-schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useFeatureFlagsMock = vi.fn();
const useSiteSettingsMock = vi.fn();
const useNavigateMock = vi.fn(() => () => undefined);

vi.mock('../hooks/use-feature-flags.js', () => ({ useFeatureFlags: useFeatureFlagsMock }));
vi.mock('../hooks/use-site-settings.js', () => ({ useSiteSettings: useSiteSettingsMock }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: useNavigateMock,
}));
vi.mock('../hooks/use-auth.js', () => ({
  signInDriverWithCustomToken: vi.fn(),
}));

const { DemoRoute } = await import('./demo.js');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useSiteSettingsMock.mockReturnValue({ config: DEFAULT_SITE_CONFIG, isLoading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DemoRoute — conditional render basado en feature flag', () => {
  it('demo_mode_activated=false → renderiza MaintenancePage (SC-INT-1)', () => {
    useFeatureFlagsMock.mockReturnValue({
      flags: {
        auth_universal_v1_activated: false,
        wake_word_voice_activated: false,
        matching_algorithm_v2_activated: false,
        demo_mode_activated: false,
      },
      isLoading: false,
      isError: false,
    });
    render(<DemoRoute />, { wrapper });
    expect(screen.getByText(/Modo demo en mantenimiento/i)).toBeInTheDocument();
    expect(screen.queryByText(/Modo demo · datos sintéticos/i)).not.toBeInTheDocument();
  });

  it('demo_mode_activated=true → renderiza el selector de personas', () => {
    useFeatureFlagsMock.mockReturnValue({
      flags: {
        auth_universal_v1_activated: false,
        wake_word_voice_activated: false,
        matching_algorithm_v2_activated: false,
        demo_mode_activated: true,
      },
      isLoading: false,
      isError: false,
    });
    render(<DemoRoute />, { wrapper });
    expect(screen.getByText(/Modo demo · datos sintéticos/i)).toBeInTheDocument();
    expect(screen.queryByText(/Modo demo en mantenimiento/i)).not.toBeInTheDocument();
  });

  it('loading inicial (flag aún no resuelto) → fail-safe a MaintenancePage', () => {
    useFeatureFlagsMock.mockReturnValue({
      flags: {
        auth_universal_v1_activated: false,
        wake_word_voice_activated: false,
        matching_algorithm_v2_activated: false,
        demo_mode_activated: false,
      },
      isLoading: true,
      isError: false,
    });
    render(<DemoRoute />, { wrapper });
    expect(screen.getByText(/Modo demo en mantenimiento/i)).toBeInTheDocument();
  });
});
