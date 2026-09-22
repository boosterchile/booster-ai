import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

let providedContext: { kind: string; me?: MeOnboarded } = { kind: 'unmanaged' };
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: unknown) => ReactNode }) =>
    children(providedContext),
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title?: string }) => (
    <main data-testid="layout" data-title={title}>
      {children}
    </main>
  ),
}));

const { EmpresaRoute } = await import('./empresa.js');

function makeMe(
  over: { role?: string; empresa?: boolean; transportista?: boolean } = {},
): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u1', email: 'jefe@x.cl', full_name: 'Jefa', rut: '11111111-1' },
    memberships: [],
    active_membership: {
      role: over.role ?? 'dueno',
      empresa:
        over.empresa === false
          ? null
          : {
              id: 'e1',
              legal_name: 'Transportes X',
              is_transportista: over.transportista ?? true,
              is_generador_carga: true,
            },
    },
  } as unknown as MeOnboarded;
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'onboarded', me: makeMe() };
});

describe('/app/empresa', () => {
  it('carga el flag real y el switch refleja el valor del servidor', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      id: 'e1',
      legal_name: 'Transportes X',
      carbon_measurement_enabled: false,
    });

    render(<EmpresaRoute />);

    expect(await screen.findByRole('switch', { name: /Medí la huella/i })).not.toBeChecked();
    expect(api.get).toHaveBeenCalledWith('/me/empresa');
    expect(screen.getByText(/recorrido real/i)).toBeInTheDocument();
  });

  it('toggle ON llama PATCH y confirma con el valor persistido', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      id: 'e1',
      legal_name: 'Transportes X',
      carbon_measurement_enabled: false,
    });
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      id: 'e1',
      carbon_measurement_enabled: true,
      carbon_measurement_enabled_anterior: false,
      unchanged: false,
    });

    render(<EmpresaRoute />);
    const sw = await screen.findByRole('switch', { name: /Medí la huella/i });
    fireEvent.click(sw);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith('/me/empresa', { carbon_measurement_enabled: true });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/vamos a medir la huella/i);
    expect(sw).toBeChecked();
  });

  it('si el PATCH falla, el switch no queda en un estado inventado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      id: 'e1',
      legal_name: 'Transportes X',
      carbon_measurement_enabled: false,
    });
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(500, 'internal_server_error', {}, 'boom'),
    );

    render(<EmpresaRoute />);
    const sw = await screen.findByRole('switch', { name: /Medí la huella/i });
    fireEvent.click(sw);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo guardar/i);
    expect(sw).not.toBeChecked();
  });

  it('el transportista guarda los umbrales y no se ofrece menos de 5 L', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      id: 'e1',
      legal_name: 'Transportes X',
      carbon_measurement_enabled: false,
      umbral_robo_golpe_l: null,
      umbral_robo_hormiga_l: 12,
    });
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      umbral_robo_golpe_l: 5,
      umbral_robo_hormiga_l: 12,
      unchanged: false,
    });

    render(<EmpresaRoute />);
    const golpe = await screen.findByLabelText('Umbral de golpe único');
    const textos = Array.from(golpe.querySelectorAll('option')).map((opcion) => opcion.textContent);
    expect(textos).toContain('5 L');
    expect(textos).toContain('20 L');
    expect(textos).not.toContain('4 L');
    expect(screen.getByLabelText('Umbral de robo hormiga')).toHaveValue('12');

    fireEvent.change(golpe, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar umbrales' }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith('/me/empresa/umbrales-combustible', {
        umbral_robo_golpe_l: 5,
        umbral_robo_hormiga_l: 12,
      });
    });
    expect(await screen.findByText(/Guardamos los umbrales/)).toBeInTheDocument();
  });

  it('un generador puro no configura los umbrales de combustible', async () => {
    providedContext = { kind: 'onboarded', me: makeMe({ transportista: false }) };
    vi.spyOn(api, 'get').mockResolvedValue({
      id: 'e1',
      legal_name: 'Transportes X',
      carbon_measurement_enabled: false,
      umbral_robo_golpe_l: null,
      umbral_robo_hormiga_l: null,
    });
    render(<EmpresaRoute />);
    expect(await screen.findByRole('switch', { name: /Medí la huella/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Umbral de golpe único')).not.toBeInTheDocument();
  });

  it('despachador no gestiona el opt-in', async () => {
    providedContext = { kind: 'onboarded', me: makeMe({ role: 'despachador' }) };
    const getSpy = vi.spyOn(api, 'get');
    render(<EmpresaRoute />);
    expect(await screen.findByText(/Solo el dueño o un administrador/i)).toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
