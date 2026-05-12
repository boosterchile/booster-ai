import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { DriverAssignmentCard } from './DriverAssignmentCard.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const SAMPLE_CONDUCTORES = [
  {
    id: 'c1',
    user_id: 'u-driver-1',
    user: {
      id: 'u-driver-1',
      full_name: 'Pedro González',
      rut: '12.345.678-5',
      is_pending: false,
    },
    status: 'activo',
  },
  {
    id: 'c2',
    user_id: 'u-driver-2',
    user: {
      id: 'u-driver-2',
      full_name: 'Ana Martínez',
      rut: '11.222.333-K',
      is_pending: false,
    },
    status: 'activo',
  },
  {
    id: 'c3',
    user_id: 'u-driver-3',
    user: {
      id: 'u-driver-3',
      full_name: 'Pending Driver',
      rut: '99.888.777-1',
      is_pending: true, // todavía no activado — debería filtrarse del dropdown
    },
    status: 'activo',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('DriverAssignmentCard', () => {
  it('assignment terminal (entregado) → no renderiza nada', () => {
    const Wrapper = makeWrapper();
    const { container } = render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName={null}
          assignmentStatus="entregado"
        />
      </Wrapper>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('sin conductor asignado → muestra prompt + dropdown poblado con conductores activos', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductores: SAMPLE_CONDUCTORES });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName={null}
          assignmentStatus="asignado"
        />
      </Wrapper>,
    );

    expect(await screen.findByText(/Asignar conductor/)).toBeInTheDocument();
    expect(
      screen.getByText(/Una vez asignado, podrá ver la asignación en su Modo Conductor/),
    ).toBeInTheDocument();

    // Dropdown tiene los activos (sin el pending).
    const select = await screen.findByTestId('driver-assignment-select');
    expect(select).toBeInTheDocument();
    // Opciones renderizadas
    expect(screen.getByText(/Pedro González · 12\.345\.678-5/)).toBeInTheDocument();
    expect(screen.getByText(/Ana Martínez · 11\.222\.333-K/)).toBeInTheDocument();
    expect(screen.queryByText(/Pending Driver/)).toBeNull(); // filtrado
  });

  it('con conductor ya asignado → muestra "Conductor actual" + opción de cambiar', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductores: SAMPLE_CONDUCTORES });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName="Pedro González"
          assignmentStatus="asignado"
        />
      </Wrapper>,
    );
    expect(await screen.findByText(/Conductor asignado/)).toBeInTheDocument();
    expect(screen.getByText(/Conductor actual:/)).toBeInTheDocument();
    expect(screen.getByText('Pedro González')).toBeInTheDocument();
    // Botón dice "Cambiar conductor" cuando ya hay uno
    expect(await screen.findByRole('button', { name: /Cambiar conductor/i })).toBeInTheDocument();
  });

  it('asignar exitoso → muestra confirmación', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductores: SAMPLE_CONDUCTORES });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      assignment_id: 'a1',
      previous_driver_user_id: null,
      new_driver_user_id: 'u-driver-1',
      driver_name: 'Pedro González',
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName={null}
          assignmentStatus="asignado"
        />
      </Wrapper>,
    );

    const select = (await screen.findByTestId('driver-assignment-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u-driver-1' } });

    const submit = screen.getByTestId('driver-assignment-submit');
    fireEvent.click(submit);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/assignments/a1/asignar-conductor', {
        driver_user_id: 'u-driver-1',
      });
    });
    expect(await screen.findByText(/Conductor asignado:/)).toBeInTheDocument();
  });

  it('error 403 forbidden_role → mensaje humanizado sobre permiso', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductores: SAMPLE_CONDUCTORES });
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, 'forbidden_role', null, 'forbidden'));

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName={null}
          assignmentStatus="asignado"
        />
      </Wrapper>,
    );

    const select = (await screen.findByTestId('driver-assignment-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u-driver-1' } });
    fireEvent.click(screen.getByTestId('driver-assignment-submit'));

    expect(
      await screen.findByText(/No tenés permiso para asignar conductores/),
    ).toBeInTheDocument();
  });

  it('error driver_not_in_carrier → mensaje claro sin código técnico', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductores: SAMPLE_CONDUCTORES });
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(400, 'driver_not_in_carrier', null, 'driver_not_in_carrier'),
    );

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName={null}
          assignmentStatus="asignado"
        />
      </Wrapper>,
    );

    const select = (await screen.findByTestId('driver-assignment-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u-driver-1' } });
    fireEvent.click(screen.getByTestId('driver-assignment-submit'));

    expect(
      await screen.findByText(/El conductor elegido no pertenece a tu empresa/),
    ).toBeInTheDocument();
  });

  it('sin conductores activos → muestra empty state con link a crear', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductores: [] });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName={null}
          assignmentStatus="asignado"
        />
      </Wrapper>,
    );
    expect(await screen.findByText(/No tenés conductores activos/)).toBeInTheDocument();
    // Y NO se muestra el form (no se debería poder asignar).
    expect(screen.queryByTestId('driver-assignment-select')).toBeNull();
  });
});
