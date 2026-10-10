import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: () => ReactNode }) => <>{children()}</>,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../hooks/use-auth.js', () => ({ signOutUser: vi.fn(async () => undefined) }));

const { PlatformAdminMandatoCobroRoute } = await import('./platform-admin-mandato-cobro.js');

const ASG = '11111111-1111-4111-8111-111111111111';
const VIAJE = {
  asignacion_id: ASG,
  modo_flujo: 'mandato_cobro',
  tracking_code: 'BOO-77',
  generador: 'Exportadora Uno',
  transportista: 'Transportes Dos',
  recepcion_conforme_en: '2026-10-10T12:00:00.000Z',
  cobro: { estado: 'pendiente', en: null, monto_clp: null, vence_en: '2026-11-09T12:00:00.000Z' },
  liberacion: {
    estado: 'pendiente',
    en: null,
    monto_clp: null,
    vence_en: '2026-10-15T12:00:00.000Z',
  },
  montos_esperados: { cobro_clp: 1_238_000, liberacion_clp: 1_000_000 },
  eventos: [],
};
const RESUMEN = {
  float_clp: 1_000_000,
  tope_float_clp: 5_000_000,
  conteos: { cobro: { pendiente: 1 }, liberacion: { pendiente: 1 } },
  viajes: [VIAJE],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformAdminMandatoCobroRoute (ADR-080)', () => {
  it('flag apagado (404): explica que rige el modo conector', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, undefined, {}));
    render(<PlatformAdminMandatoCobroRoute />);
    expect(await screen.findByText(/modo conector/)).toBeInTheDocument();
  });

  it('error genérico al cargar', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('red'));
    render(<PlatformAdminMandatoCobroRoute />);
    expect(await screen.findByText(/No se pudo cargar/)).toBeInTheDocument();
  });

  it('muestra float, tope, disponible y los viajes; lista vacía con mensaje', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(RESUMEN);
    const { unmount } = render(<PlatformAdminMandatoCobroRoute />);
    expect(await screen.findByText('BOO-77')).toBeInTheDocument();
    expect(screen.getByText(/1\.000\.000/)).toBeInTheDocument();
    expect(screen.getByText(/5\.000\.000/)).toBeInTheDocument();
    expect(screen.getByText(/4\.000\.000/)).toBeInTheDocument();
    unmount();
    get.mockResolvedValue({ ...RESUMEN, viajes: [] });
    render(<PlatformAdminMandatoCobroRoute />);
    expect(await screen.findByText(/No hay viajes en mandato/)).toBeInTheDocument();
  });

  it('registra un cobro con el monto esperado precargado y recarga', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(RESUMEN);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ pago: VIAJE });
    render(<PlatformAdminMandatoCobroRoute />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar' }));
    expect(screen.getByLabelText(/Monto/)).toHaveValue(1_238_000);
    await userEvent.type(screen.getByLabelText(/Evidencia/), 'abono-123');
    const form = screen.getByRole('form', { name: /BOO-77/ });
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [ruta, body] = post.mock.calls[0] ?? [];
    expect(ruta).toBe(`/admin/mandato-cobro/${ASG}/eventos`);
    expect(body).toMatchObject({
      tipo: 'cobro_registrado',
      monto_clp: 1_238_000,
      evidencia_ref: 'abono-123',
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('liberación sobre el tope: muestra el error claro; resolver disputa no envía monto', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(RESUMEN);
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new ApiError(422, undefined, {}, 'tope_float_excedido'))
      .mockRejectedValueOnce(new Error('red'));
    render(<PlatformAdminMandatoCobroRoute />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar' }));
    await userEvent.selectOptions(screen.getByLabelText(/Evento/), 'liberacion_booster');
    expect(screen.getByLabelText(/Monto/)).toHaveValue(1_000_000);
    await userEvent.type(screen.getByLabelText(/Evidencia/), 'trf-9');
    const form = screen.getByRole('form', { name: /BOO-77/ });
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText(/Supera el tope del float/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/Evento/), 'disputa_resuelta');
    expect(screen.queryByLabelText(/Monto/)).toBeNull();
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('No se pudo registrar el evento.')).toBeInTheDocument();
    expect(post.mock.calls[1]?.[1]).not.toHaveProperty('monto_clp');

    await userEvent.selectOptions(screen.getByLabelText(/Evento/), 'anticipo_operador');
    expect(screen.getByLabelText(/Monto/)).toHaveValue(null);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: /BOO-77/ })).toBeNull();
  });
});
