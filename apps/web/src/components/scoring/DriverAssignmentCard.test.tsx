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

const SAMPLE_VEHICULOS = [
  {
    id: 'v-1',
    plate: 'ABCD12',
    type: 'camion_pesado',
    unit_category: 'motriz',
    status: 'activo',
  },
  {
    id: 'v-arrastre',
    plate: 'SEMI01',
    type: 'semi_remolque',
    unit_category: 'arrastre',
    status: 'activo',
  },
  {
    id: 'v-retirado',
    plate: 'OLD001',
    type: 'camion_mediano',
    unit_category: 'motriz',
    status: 'retirado',
  },
];

function mockListas(conductores = SAMPLE_CONDUCTORES) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/conductores') {
      return { conductores };
    }
    if (path === '/vehiculos') {
      return { vehicles: SAMPLE_VEHICULOS };
    }
    throw new Error(`GET inesperado: ${path}`);
  });
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
      rut: '11.111.111-1',
      email: 'pendiente@example.com',
      is_pending: true,
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

  it('sin conductor asignado → camiones motrices activos y conductores, incluido el pendiente', async () => {
    mockListas();
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

    expect(await screen.findByText(/Asignar camión y conductor/)).toBeInTheDocument();
    expect(await screen.findByTestId('vehicle-assignment-select')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ABCD12' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SEMI01' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'OLD001' })).toBeNull();

    const select = await screen.findByTestId('driver-assignment-select');
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/Pedro González · 12\.345\.678-5/)).toBeInTheDocument();
    expect(screen.getByText(/Ana Martínez · 11\.222\.333-K/)).toBeInTheDocument();
    expect(
      screen.getByRole('option', {
        name: /Pending Driver · 11\.111\.111-1 · pendiente de activación/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });

  it('con conductor ya asignado → muestra "Conductor actual" + opción de cambiar', async () => {
    mockListas();
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
    expect(await screen.findByText(/Camión y conductor/)).toBeInTheDocument();
    expect(screen.getByText(/Conductor actual:/)).toBeInTheDocument();
    expect(screen.getByText('Pedro González')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
  });

  it('viaje recogido → oculta el camión y confirma solo el conductor', async () => {
    mockListas();
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      assignment_id: 'a1',
      previous_driver_user_id: 'u-driver-1',
      new_driver_user_id: 'u-driver-2',
      driver_name: 'Ana Martínez',
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName="Pedro González"
          currentVehicleId="v-1"
          assignmentStatus="recogido"
        />
      </Wrapper>,
    );

    expect(await screen.findByTestId('driver-assignment-select')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-assignment-select')).toBeNull();

    fireEvent.change(screen.getByTestId('driver-assignment-select'), {
      target: { value: 'u-driver-2' },
    });
    fireEvent.click(screen.getByTestId('driver-assignment-submit'));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/assignments/a1/asignar-conductor', {
        driver_user_id: 'u-driver-2',
      });
    });
  });

  it('asignar exitoso → muestra confirmación', async () => {
    mockListas();
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

    const vehicle = (await screen.findByTestId('vehicle-assignment-select')) as HTMLSelectElement;
    fireEvent.change(vehicle, { target: { value: 'v-1' } });
    const select = (await screen.findByTestId('driver-assignment-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u-driver-1' } });

    const submit = screen.getByTestId('driver-assignment-submit');
    fireEvent.click(submit);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/assignments/a1/asignar-conductor', {
        driver_user_id: 'u-driver-1',
        vehiculo_id: 'v-1',
      });
    });
    expect(await screen.findByText(/Conductor asignado:/)).toBeInTheDocument();
  });

  it('error 403 forbidden_role → mensaje humanizado sobre permiso', async () => {
    mockListas();
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

    const vehicle = (await screen.findByTestId('vehicle-assignment-select')) as HTMLSelectElement;
    fireEvent.change(vehicle, { target: { value: 'v-1' } });
    const select = (await screen.findByTestId('driver-assignment-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u-driver-1' } });
    fireEvent.click(screen.getByTestId('driver-assignment-submit'));

    expect(
      await screen.findByText(/No tienes permiso para asignar conductores/),
    ).toBeInTheDocument();
  });

  it('error driver_not_in_carrier → mensaje claro sin código técnico', async () => {
    mockListas();
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

    const vehicle = (await screen.findByTestId('vehicle-assignment-select')) as HTMLSelectElement;
    fireEvent.change(vehicle, { target: { value: 'v-1' } });
    const select = (await screen.findByTestId('driver-assignment-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u-driver-1' } });
    fireEvent.click(screen.getByTestId('driver-assignment-submit'));

    expect(
      await screen.findByText(/El conductor elegido no pertenece a tu empresa/),
    ).toBeInTheDocument();
  });

  it('sin camiones activos → explica que falta flota y no deja confirmar', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/conductores') {
        return { conductores: SAMPLE_CONDUCTORES };
      }
      if (path === '/vehiculos') {
        return { vehicles: [] };
      }
      throw new Error(`GET inesperado: ${path}`);
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
    expect(await screen.findByText(/No tienes camiones activos/)).toBeInTheDocument();
    expect(screen.queryByTestId('driver-assignment-submit')).toBeNull();
  });

  it('nombre largo: los selects quedan a w-full y el texto del conductor parte', async () => {
    const nombre = 'María Fernanda Contreras Valdebenito';
    mockListas([
      {
        id: 'c-largo',
        user_id: 'u-largo',
        user: {
          id: 'u-largo',
          full_name: nombre,
          rut: '11.111.111-1',
          email: 'conductor.largo@example.com',
          is_pending: true,
        },
        status: 'activo',
      },
    ]);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DriverAssignmentCard
          assignmentId="a1"
          currentDriverName={nombre}
          assignmentStatus="asignado"
        />
      </Wrapper>,
    );

    const conductor = await screen.findByTestId('driver-assignment-select');
    const camion = screen.getByTestId('vehicle-assignment-select');
    expect(conductor).toHaveClass('w-full', 'min-w-0', 'max-w-full');
    expect(camion).toHaveClass('w-full', 'min-w-0', 'max-w-full');
    expect(screen.getByTestId('driver-assignment-card')).toHaveClass('min-w-0', 'max-w-full');
    expect(screen.getByText(/Conductor actual:/)).toHaveClass('break-words');
    expect(screen.getByTestId('driver-assignment-submit')).toHaveClass('w-full');
    expect(
      screen.getByRole('option', {
        name: /María Fernanda Contreras Valdebenito · 11\.111\.111-1 · pendiente de activación/,
      }),
    ).toBeInTheDocument();
  });

  it('un camión activo sin IMEI sigue en el selector; el retirado no', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/conductores') {
        return { conductores: SAMPLE_CONDUCTORES };
      }
      if (path === '/vehiculos') {
        return {
          vehicles: [
            {
              id: 'v-sin-senal',
              plate: 'SINS01',
              type: 'camion_pesado',
              unit_category: 'motriz',
              status: 'activo',
              teltonika_imei: null,
            },
            {
              id: 'v-baja',
              plate: 'BAJA01',
              type: 'camion_pesado',
              unit_category: 'motriz',
              status: 'retirado',
              teltonika_imei: null,
            },
          ],
        };
      }
      throw new Error(`GET inesperado: ${path}`);
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
    expect(await screen.findByRole('option', { name: 'SINS01' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'BAJA01' })).toBeNull();
  });

  it('sin conductores activos → muestra empty state con link a crear', async () => {
    mockListas([]);
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
    expect(await screen.findByText(/No tienes conductores activos/)).toBeInTheDocument();
    // Y NO se muestra el form (no se debería poder asignar).
    expect(screen.queryByTestId('driver-assignment-select')).toBeNull();
  });
});
