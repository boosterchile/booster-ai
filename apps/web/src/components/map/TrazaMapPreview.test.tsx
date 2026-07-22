import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng } from '../../lib/polyline.js';

// Mock env ANTES de importar el componente (lee VITE_GOOGLE_MAPS_API_KEY al render).
const envMock = { VITE_GOOGLE_MAPS_API_KEY: '' as string | undefined };
vi.mock('../../lib/env.js', () => ({
  get env() {
    return envMock;
  },
}));

interface FakeMap {
  fitBounds: ReturnType<typeof vi.fn>;
}

class FakeLatLngBounds {
  constructor(
    public sw: { lat: number; lng: number },
    public ne: { lat: number; lng: number },
  ) {}
}

class FakePolyline {
  static instances: FakePolyline[] = [];
  setMap = vi.fn();
  constructor(public opts: unknown) {
    FakePolyline.instances.push(this);
  }
}

const mapState: { map: FakeMap | null; libs: Record<string, unknown> } = {
  map: null,
  libs: {},
};

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: ({ children }: { children: ReactNode }) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ title, children }: { title: string; children: ReactNode }) => (
    <div data-testid={`marker-${title.toLowerCase()}`}>{children}</div>
  ),
  Pin: ({ children }: { children: ReactNode }) => <span data-testid="pin">{children}</span>,
  useMap: () => mapState.map,
  useMapsLibrary: (name: string) => mapState.libs[name] ?? null,
}));

const { TrazaMapPreview } = await import('./TrazaMapPreview.js');

const PUNTOS: LatLng[] = [
  { lat: -33.4, lng: -70.6 },
  { lat: -33.45, lng: -70.61 },
  { lat: -33.5, lng: -70.62 },
];

beforeEach(() => {
  envMock.VITE_GOOGLE_MAPS_API_KEY = '';
  mapState.map = null;
  mapState.libs = {};
  FakePolyline.instances = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TrazaMapPreview', () => {
  it('sin VITE_GOOGLE_MAPS_API_KEY → fallback no disponible', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = '';
    render(<TrazaMapPreview points={PUNTOS} />);
    expect(screen.getByTestId('traza-map-no-key')).toBeInTheDocument();
  });

  it('sin puntos + API key → fallback "sin recorrido"', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'fake-key';
    render(<TrazaMapPreview points={[]} />);
    expect(screen.getByTestId('traza-map-empty')).toBeInTheDocument();
  });

  it('puntos + API key → monta APIProvider + Map + markers Inicio/Fin', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'fake-key';
    render(<TrazaMapPreview points={PUNTOS} />);
    expect(screen.getByTestId('traza-map')).toBeInTheDocument();
    expect(screen.getByTestId('api-provider')).toBeInTheDocument();
    expect(screen.getByTestId('marker-inicio')).toBeInTheDocument();
    expect(screen.getByTestId('marker-fin')).toBeInTheDocument();
  });

  it('con map + libs → dibuja la Polyline y hace fitBounds', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'fake-key';
    const fitBounds = vi.fn();
    mapState.map = { fitBounds };
    mapState.libs = {
      maps: { Polyline: FakePolyline },
      core: { LatLngBounds: FakeLatLngBounds },
    };
    render(<TrazaMapPreview points={PUNTOS} />);
    expect(FakePolyline.instances).toHaveLength(1);
    expect(FakePolyline.instances[0]?.setMap).toHaveBeenCalled();
    expect(fitBounds).toHaveBeenCalled();
  });

  it('con ruta esperada → dibuja 2 polylines (real azul + esperada verde)', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'fake-key';
    mapState.map = { fitBounds: vi.fn() };
    mapState.libs = {
      maps: { Polyline: FakePolyline },
      core: { LatLngBounds: FakeLatLngBounds },
    };
    render(<TrazaMapPreview points={PUNTOS} expectedRoute={PUNTOS} />);
    expect(FakePolyline.instances).toHaveLength(2);
  });

  it('solo ruta esperada (sin traza real) → monta el mapa igual', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'fake-key';
    render(<TrazaMapPreview points={[]} expectedRoute={PUNTOS} />);
    expect(screen.getByTestId('traza-map')).toBeInTheDocument();
  });
});
