import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { CobraHoyButton } from './CobraHoyButton.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderButton(asignacionId = 'asg-1') {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <CobraHoyButton asignacionId={asignacionId} />
    </Wrapper>,
  );
}

const COTIZ_OK = {
  monto_neto_clp: 176000,
  plazo_dias_shipper: 30,
  tarifa_pct: 1.5,
  tarifa_clp: 2640,
  monto_adelantado_clp: 173360,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CobraHoyButton — botón inicial', () => {
  it('renderiza botón con label "Cobra hoy"', () => {
    renderButton();
    expect(screen.getByRole('button', { name: /Cobra hoy/i })).toBeInTheDocument();
  });

  it('no abre modal sin click', () => {
    renderButton();
    expect(screen.queryByRole('heading', { name: /Cobra hoy/i })).not.toBeInTheDocument();
  });
});

describe('CobraHoyButton — modal con cotización OK', () => {
  it('al hacer click abre modal y muestra desglose', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(COTIZ_OK);
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Cobra hoy/i }));
    expect(await screen.findByText(/Monto neto del viaje/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s?176\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Tarifa pronto pago \(1\.50%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Recibes hoy/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s?173\.360/)).toBeInTheDocument();
    expect(screen.getByText(/30 días corridos/)).toBeInTheDocument();
  });

  it('botón de confirmar habilitado y dispara POST con success', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(COTIZ_OK);
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      already_requested: false,
      adelanto_id: 'adel-1',
      tarifa_pct: 1.5,
      tarifa_clp: 2640,
      monto_adelantado_clp: 173360,
    });
    renderButton('asg-xyz');
    fireEvent.click(screen.getByRole('button', { name: /Cobra hoy/i }));
    const confirm = await screen.findByRole('button', { name: /Confirmar y recibir hoy/i });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/assignments/asg-xyz/cobra-hoy', {});
    });
    expect(await screen.findByText(/Solicitud recibida/)).toBeInTheDocument();
  });

  it('already_requested → mensaje específico', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(COTIZ_OK);
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      already_requested: true,
      adelanto_id: 'adel-1',
    });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Cobra hoy/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar y recibir hoy/i }));
    expect(await screen.findByText(/Ya tenías una solicitud en curso/)).toBeInTheDocument();
  });
});

describe('CobraHoyButton — modal con errores backend', () => {
  it('503 feature_disabled → muestra mensaje y oculta confirm', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'feature_disabled', null));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Cobra hoy/i }));
    expect(await screen.findByText(/La opción de pronto pago no está activa/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Confirmar y recibir hoy/i }),
    ).not.toBeInTheDocument();
  });

  it('409 no_liquidacion → mensaje claro al carrier', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(
      new ApiError(409, 'no_liquidacion', { code: 'no_liquidacion' }),
    );
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Cobra hoy/i }));
    expect(await screen.findByText(/Tu viaje aún no fue liquidado/)).toBeInTheDocument();
  });

  it('error de mutation → alert visible', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(COTIZ_OK);
    vi.spyOn(api, 'post').mockRejectedValue(new Error('boom'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Cobra hoy/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar y recibir hoy/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos procesar la solicitud/);
  });
});

describe('CobraHoyButton — cerrar modal', () => {
  it('Cancelar cierra el modal', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(COTIZ_OK);
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Cobra hoy/i }));
    await screen.findByText(/Recibes hoy/);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Recibes hoy/)).not.toBeInTheDocument();
    });
  });
});
