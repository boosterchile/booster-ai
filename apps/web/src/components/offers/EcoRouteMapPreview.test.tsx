import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock env BEFORE importing the component — the component reads
// `env.VITE_GOOGLE_MAPS_API_KEY` at render time and the test exercises
// both the "no key" and "with key" branches.
const envMock = { VITE_GOOGLE_MAPS_API_KEY: '' as string | undefined };
vi.mock('../../lib/env.js', () => ({
  get env() {
    return envMock;
  },
}));

// Mock @vis.gl/react-google-maps so we don't actually mount the map.
// The integration test happens manually in staging — here we only
// verify the React shape: which branch renders.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: ({ children }: { children: ReactNode }) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ title, children }: { title: string; children: ReactNode }) => (
    <div data-testid={`marker-${title.toLowerCase()}`}>{children}</div>
  ),
  Pin: ({ children }: { children: ReactNode }) => <span data-testid="pin">{children}</span>,
  useMap: () => null,
  useMapsLibrary: () => null,
}));

const { EcoRouteMapPreview } = await import('./EcoRouteMapPreview.js');

// Reference polyline from Google docs (3 points: 38.5,-120.2 → 40.7,-120.95 → 43.252,-126.453).
const VALID_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

beforeEach(() => {
  envMock.VITE_GOOGLE_MAPS_API_KEY = '';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EcoRouteMapPreview', () => {
  it('sin VITE_GOOGLE_MAPS_API_KEY → fallback "Mapa no disponible"', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = '';
    render(<EcoRouteMapPreview polylineEncoded={VALID_POLYLINE} />);
    expect(screen.getByTestId('eco-route-map-no-key')).toBeInTheDocument();
    expect(screen.queryByTestId('google-map')).not.toBeInTheDocument();
  });

  it('polyline vacío → render fallback "no se pudo decodificar"', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'fake-key';
    render(<EcoRouteMapPreview polylineEncoded="" />);
    expect(screen.getByTestId('eco-route-map-empty')).toBeInTheDocument();
  });

  it('polyline válido + API key → monta APIProvider + Map + markers O y D', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'fake-key';
    render(<EcoRouteMapPreview polylineEncoded={VALID_POLYLINE} />);
    expect(screen.getByTestId('eco-route-map')).toBeInTheDocument();
    expect(screen.getByTestId('api-provider')).toBeInTheDocument();
    expect(screen.getByTestId('google-map')).toBeInTheDocument();
    // Markers de origen y destino con los títulos esperados (lowercased en testid).
    expect(screen.getByTestId('marker-origen')).toBeInTheDocument();
    expect(screen.getByTestId('marker-destino')).toBeInTheDocument();
  });

  it('respeta prop height', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = '';
    const { container } = render(
      <EcoRouteMapPreview polylineEncoded={VALID_POLYLINE} height={400} />,
    );
    const fallback = container.querySelector('[data-testid="eco-route-map-no-key"]') as HTMLElement;
    expect(fallback.style.height).toBe('400px');
  });
});
