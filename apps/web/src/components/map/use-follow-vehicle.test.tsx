import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowVehicle, useFollowVehicle } from './use-follow-vehicle.js';

/**
 * Tests del follow controller. Mockeamos `useMap()` de
 * @vis.gl/react-google-maps con un fake que registra listeners en memoria
 * y permite dispararlos a mano para simular interacciones del usuario.
 *
 * Cubre:
 *   - panTo automático al montar y al cambiar coords mientras follow=true
 *   - primer `zoom_changed` (defaultZoom apply) NO pausa follow
 *   - `zoom_changed` posterior (user) sí pausa
 *   - `dragstart` pausa follow
 *   - resume() re-activa follow, dispara panTo+setZoom (si zoom cambia)
 *   - el `zoom_changed` que dispara el setZoom programático NO re-pausa
 */

interface FakeMap {
  panTo: ReturnType<typeof vi.fn>;
  setZoom: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
}

const listeners: Record<string, Array<() => void>> = {};
let fakeMap: FakeMap;

vi.mock('@vis.gl/react-google-maps', () => ({
  useMap: () => fakeMap,
}));

function fire(event: string) {
  for (const cb of listeners[event] ?? []) {
    cb();
  }
}

function makeFakeMap(currentZoom: number): FakeMap {
  return {
    panTo: vi.fn(),
    setZoom: vi.fn(),
    getZoom: vi.fn(() => currentZoom),
    addListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return {
        remove: () => {
          listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb);
        },
      };
    }),
  };
}

function Harness({
  lat,
  lng,
  zoom,
}: {
  lat: number;
  lng: number;
  zoom?: number;
}) {
  const follow = useFollowVehicle();
  return (
    <>
      <FollowVehicle controller={follow} latitude={lat} longitude={lng} zoom={zoom} />
      <div data-testid="status">{follow.following ? 'following' : 'paused'}</div>
      <button type="button" onClick={follow.resume}>
        Recentrar
      </button>
    </>
  );
}

describe('useFollowVehicle / FollowVehicle', () => {
  beforeEach(() => {
    for (const k of Object.keys(listeners)) {
      delete listeners[k];
    }
    fakeMap = makeFakeMap(10);
  });

  it('hace panTo al montar con la posición inicial', () => {
    render(<Harness lat={-33.45} lng={-70.66} zoom={14} />);
    expect(fakeMap.panTo).toHaveBeenCalledWith({ lat: -33.45, lng: -70.66 });
  });

  it('hace panTo cuando cambian las coords mientras follow está activo', () => {
    const { rerender } = render(<Harness lat={1} lng={2} zoom={14} />);
    fakeMap.panTo.mockClear();
    rerender(<Harness lat={3} lng={4} zoom={14} />);
    expect(fakeMap.panTo).toHaveBeenCalledWith({ lat: 3, lng: 4 });
  });

  it('ignora el primer zoom_changed (apply de defaultZoom al montar)', () => {
    render(<Harness lat={1} lng={2} zoom={14} />);
    act(() => fire('zoom_changed'));
    expect(screen.getByTestId('status')).toHaveTextContent('following');
  });

  it('pausa follow cuando el usuario hace zoom (zoom_changed posterior)', () => {
    render(<Harness lat={1} lng={2} zoom={14} />);
    act(() => fire('zoom_changed')); // initial — ignorado
    act(() => fire('zoom_changed')); // user — pausa
    expect(screen.getByTestId('status')).toHaveTextContent('paused');
  });

  it('pausa follow cuando el usuario arrastra el mapa', () => {
    render(<Harness lat={1} lng={2} zoom={14} />);
    act(() => fire('dragstart'));
    expect(screen.getByTestId('status')).toHaveTextContent('paused');
  });

  it('NO hace panTo cuando follow está pausado y llegan coords nuevas', () => {
    const { rerender } = render(<Harness lat={1} lng={2} zoom={14} />);
    act(() => fire('dragstart'));
    fakeMap.panTo.mockClear();
    rerender(<Harness lat={3} lng={4} zoom={14} />);
    expect(fakeMap.panTo).not.toHaveBeenCalled();
  });

  it('resume() reactiva follow + panTo + setZoom al default cuando el zoom actual difiere', () => {
    fakeMap = makeFakeMap(10); // zoom actual ≠ default (14)
    render(<Harness lat={1} lng={2} zoom={14} />);
    act(() => fire('dragstart')); // pausar
    expect(screen.getByTestId('status')).toHaveTextContent('paused');

    fakeMap.panTo.mockClear();
    fakeMap.setZoom.mockClear();

    act(() => screen.getByRole('button', { name: 'Recentrar' }).click());

    expect(fakeMap.panTo).toHaveBeenCalledWith({ lat: 1, lng: 2 });
    expect(fakeMap.setZoom).toHaveBeenCalledWith(14);
    expect(screen.getByTestId('status')).toHaveTextContent('following');
  });

  it('resume() NO llama setZoom si el zoom ya es el default', () => {
    fakeMap = makeFakeMap(14); // ya en default
    render(<Harness lat={1} lng={2} zoom={14} />);
    act(() => fire('dragstart'));
    fakeMap.setZoom.mockClear();

    act(() => screen.getByRole('button', { name: 'Recentrar' }).click());

    expect(fakeMap.setZoom).not.toHaveBeenCalled();
    expect(screen.getByTestId('status')).toHaveTextContent('following');
  });

  it('el zoom_changed disparado por el setZoom programático del resume NO re-pausa', () => {
    fakeMap = makeFakeMap(10);
    render(<Harness lat={1} lng={2} zoom={14} />);
    act(() => fire('zoom_changed')); // initial — ignorado
    act(() => fire('dragstart')); // user — pausa

    act(() => screen.getByRole('button', { name: 'Recentrar' }).click());
    // Simular el zoom_changed que la lib dispararía tras setZoom(14):
    act(() => fire('zoom_changed'));
    expect(screen.getByTestId('status')).toHaveTextContent('following');

    // Pero un siguiente zoom_changed (user real) sí pausa:
    act(() => fire('zoom_changed'));
    expect(screen.getByTestId('status')).toHaveTextContent('paused');
  });

  it('si no se pasa zoom prop, resume() solo hace panTo (no toca el zoom)', () => {
    fakeMap = makeFakeMap(10);
    render(<Harness lat={1} lng={2} />);
    act(() => fire('dragstart'));
    fakeMap.setZoom.mockClear();
    fakeMap.panTo.mockClear();

    act(() => screen.getByRole('button', { name: 'Recentrar' }).click());

    expect(fakeMap.panTo).toHaveBeenCalledWith({ lat: 1, lng: 2 });
    expect(fakeMap.setZoom).not.toHaveBeenCalled();
  });

  it('limpia los listeners de Google Maps al desmontar', () => {
    const { unmount } = render(<Harness lat={1} lng={2} zoom={14} />);
    expect(listeners.dragstart).toHaveLength(1);
    expect(listeners.zoom_changed).toHaveLength(1);

    unmount();

    expect(listeners.dragstart ?? []).toHaveLength(0);
    expect(listeners.zoom_changed ?? []).toHaveLength(0);
  });
});
