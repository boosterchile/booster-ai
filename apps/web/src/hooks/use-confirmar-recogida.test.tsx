import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 9 (medicion-huella-segmento): disparo híbrido de la recogida.
 *
 * El geofence del origen (evaluado en el API, T8) SUGIERE; el conductor
 * confirma con un tap. Con cruce detectado, `picked_up_at` = instante del
 * cruce (timestamp de la posición que entró al radio). Sin geofence (origen
 * sin geocodificar, sin GPS, sin permiso), el tap manual sigue disponible y el
 * servidor pone `now`. La recogida NUNCA se bloquea por falta de señal.
 */
const apiPatchSpy = vi.fn();
vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return {
    ...actual,
    api: { ...actual.api, patch: (...args: unknown[]) => apiPatchSpy(...args) },
  };
});

const { ApiError } = await import('../lib/api-client.js');
const { useConfirmarRecogida } = await import('./use-confirmar-recogida.js');
type GeofenceLectura = import('./use-driver-position-reporter.js').GeofenceLectura;

const ASSIGNMENT_ID = 'asg-123';
const URL = `/assignments/${ASSIGNMENT_ID}/confirmar-recogida`;
const T1 = '2026-08-02T09:30:00.000Z';
const T2 = '2026-08-02T09:31:00.000Z';

function lectura(estado: GeofenceLectura['estado'], at: string): GeofenceLectura {
  return { estado, distanciaM: estado === 'dentro' ? 40 : 900, at };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiPatchSpy.mockResolvedValue({ ok: true, already_picked_up: false, picked_up_at: T1 });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConfirmarRecogida', () => {
  it('sin geofence: no sugiere; confirmar() hace el PATCH SIN body (el servidor pone now)', async () => {
    const { result } = renderHook(() =>
      useConfirmarRecogida({ assignmentId: ASSIGNMENT_ID, initialRecogida: false, geofence: null }),
    );

    expect(result.current.sugerida).toBe(false);
    expect(result.current.enteredAt).toBeNull();

    await act(() => result.current.confirmar());

    expect(apiPatchSpy).toHaveBeenCalledTimes(1);
    expect(apiPatchSpy).toHaveBeenCalledWith(URL);
    expect(result.current.recogida).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('geofence dentro en T1: sugiere, y confirmar() manda picked_up_at = T1 (instante del cruce)', async () => {
    const { result } = renderHook(() =>
      useConfirmarRecogida({
        assignmentId: ASSIGNMENT_ID,
        initialRecogida: false,
        geofence: lectura('dentro', T1),
      }),
    );

    await waitFor(() => expect(result.current.sugerida).toBe(true));
    expect(result.current.enteredAt).toBe(T1);

    await act(() => result.current.confirmar());

    expect(apiPatchSpy).toHaveBeenCalledWith(URL, { picked_up_at: T1 });
    expect(result.current.recogida).toBe(true);
  });

  it('el instante del cruce es el PRIMER "dentro": fuera → dentro(T2) → fuera conserva T2 y sigue sugiriendo', async () => {
    const { result, rerender } = renderHook(
      ({ geofence }: { geofence: GeofenceLectura | null }) =>
        useConfirmarRecogida({ assignmentId: ASSIGNMENT_ID, initialRecogida: false, geofence }),
      { initialProps: { geofence: lectura('fuera', T1) } },
    );
    expect(result.current.sugerida).toBe(false);

    rerender({ geofence: lectura('dentro', T2) });
    await waitFor(() => expect(result.current.enteredAt).toBe(T2));

    // Jitter de GPS: sale del radio un instante. La sugerencia no parpadea y el
    // cruce no se reescribe.
    rerender({ geofence: lectura('fuera', '2026-08-02T09:32:00.000Z') });
    expect(result.current.enteredAt).toBe(T2);
    expect(result.current.sugerida).toBe(true);

    await act(() => result.current.confirmar());
    expect(apiPatchSpy).toHaveBeenCalledWith(URL, { picked_up_at: T2 });
  });

  it('origen sin geocodificar (sin_origen): no sugiere y el tap manual sigue disponible sin body', async () => {
    const { result } = renderHook(() =>
      useConfirmarRecogida({
        assignmentId: ASSIGNMENT_ID,
        initialRecogida: false,
        geofence: lectura('sin_origen', T1),
      }),
    );

    expect(result.current.sugerida).toBe(false);
    await act(() => result.current.confirmar());
    expect(apiPatchSpy).toHaveBeenCalledWith(URL);
    expect(result.current.recogida).toBe(true);
  });

  it('ya recogida al montar: no sugiere aunque el geofence diga dentro', () => {
    const { result } = renderHook(() =>
      useConfirmarRecogida({
        assignmentId: ASSIGNMENT_ID,
        initialRecogida: true,
        geofence: lectura('dentro', T1),
      }),
    );
    expect(result.current.recogida).toBe(true);
    expect(result.current.sugerida).toBe(false);
  });

  it('el backend contestó (409 invalid_status): mensaje accionable que NO culpa a la señal', async () => {
    apiPatchSpy.mockRejectedValueOnce(new ApiError(409, 'invalid_status', {}));
    const { result } = renderHook(() =>
      useConfirmarRecogida({ assignmentId: ASSIGNMENT_ID, initialRecogida: false, geofence: null }),
    );

    await act(() => result.current.confirmar());

    expect(result.current.recogida).toBe(false);
    expect(result.current.error ?? '').not.toMatch(/señal|senal/i);
    expect(result.current.error ?? '').toMatch(/ya no está esperando/i);
  });

  it.each([
    ['forbidden', /no está a tu nombre/i],
    ['assignment_not_found', /no encontramos este viaje/i],
    ['invalid_picked_up_at', /hora de llegada.*no es válida/i],
    ['algo_desconocido', /avísale a tu empresa/i],
  ])('mapea el código %s a un mensaje accionable en español', async (code, esperado) => {
    apiPatchSpy.mockRejectedValueOnce(new ApiError(400, code, {}));
    const { result } = renderHook(() =>
      useConfirmarRecogida({ assignmentId: ASSIGNMENT_ID, initialRecogida: false, geofence: null }),
    );

    await act(() => result.current.confirmar());

    expect(result.current.error ?? '').toMatch(esperado);
    expect(result.current.error ?? '').not.toMatch(/señal|senal/i);
  });

  it('caída de red: sí culpa a la señal y deja reintentar', async () => {
    apiPatchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() =>
      useConfirmarRecogida({ assignmentId: ASSIGNMENT_ID, initialRecogida: false, geofence: null }),
    );

    await act(() => result.current.confirmar());

    expect(result.current.recogida).toBe(false);
    expect(result.current.recogiendo).toBe(false);
    expect(result.current.error ?? '').toMatch(/señal/i);
  });
});
