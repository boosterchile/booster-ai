import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfferPayload } from '../../hooks/use-offers.js';
import { ApiError, api } from '../../lib/api-client.js';
import { OfferCard } from './OfferCard.js';

function makeOffer(over: Partial<OfferPayload> = {}): OfferPayload {
  return {
    id: 'o1',
    status: 'pendiente',
    score: 0.85,
    proposed_price_clp: 250_000,
    suggested_vehicle_id: null,
    sent_at: '2026-05-10T10:00:00Z',
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    responded_at: null,
    rejection_reason: null,
    trip_request: {
      id: 'tr1',
      tracking_code: 'BST-001',
      status: 'pendiente',
      origin_address_raw: 'Av. Apoquindo 4500',
      origin_region_code: 'XIII',
      destination_address_raw: 'Plaza Sotomayor',
      destination_region_code: 'V',
      cargo_type: 'carga_seca',
      cargo_weight_kg: 5000,
      pickup_window_start: '2026-05-11T08:00:00Z',
      pickup_window_end: '2026-05-11T18:00:00Z',
    },
    ...over,
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderCard(offer: OfferPayload = makeOffer()) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <OfferCard offer={offer} />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('OfferCard — render base', () => {
  it('muestra tracking code, regiones, precio y carga', () => {
    renderCard();
    expect(screen.getByText('BST-001')).toBeInTheDocument();
    expect(screen.getByText(/RM →/)).toBeInTheDocument();
    expect(screen.getByText(/Valparaíso/)).toBeInTheDocument();
    expect(screen.getByText(/250\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Carga seca/)).toBeInTheDocument();
    expect(screen.getByText(/5\.000 kg/)).toBeInTheDocument();
  });

  it('cargo_type desconocido → muestra el código raw', () => {
    renderCard(makeOffer({ trip_request: { ...makeOffer().trip_request, cargo_type: 'mistery' } }));
    expect(screen.getByText(/mistery/)).toBeInTheDocument();
  });

  it('region_code desconocido → muestra el código raw', () => {
    renderCard(
      makeOffer({
        trip_request: {
          ...makeOffer().trip_request,
          origin_region_code: 'ZZ',
          destination_region_code: 'YY',
        },
      }),
    );
    expect(screen.getByText(/ZZ → YY/)).toBeInTheDocument();
  });

  it('region_code null → muestra "—"', () => {
    renderCard(
      makeOffer({
        trip_request: {
          ...makeOffer().trip_request,
          origin_region_code: null,
          destination_region_code: null,
        },
      }),
    );
    expect(screen.getByText(/— → —/)).toBeInTheDocument();
  });

  it('cargo_weight_kg null → no muestra peso', () => {
    renderCard(makeOffer({ trip_request: { ...makeOffer().trip_request, cargo_weight_kg: null } }));
    expect(screen.queryByText(/kg/)).not.toBeInTheDocument();
  });

  it('pickup_window null → muestra "—"', () => {
    renderCard(
      makeOffer({
        trip_request: {
          ...makeOffer().trip_request,
          pickup_window_start: null,
          pickup_window_end: null,
        },
      }),
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('OfferCard — timeRemaining states', () => {
  it('expirada (expires_at en el pasado) → "Expirada" + urgent', () => {
    renderCard(makeOffer({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(screen.getByText('Expirada')).toBeInTheDocument();
  });

  it('< 15 min → urgent visual', () => {
    // +5 min y un buffer para evitar que la división redondee a 4 si
    // pasaron unos ms entre el cálculo del expires_at y el timeRemaining.
    renderCard(makeOffer({ expires_at: new Date(Date.now() + 5 * 60_000 + 5_000).toISOString() }));
    expect(screen.getByText(/[45] min/)).toBeInTheDocument();
  });

  it('45 min → no urgent + label "min"', () => {
    renderCard(makeOffer({ expires_at: new Date(Date.now() + 45 * 60_000 + 5_000).toISOString() }));
    expect(screen.getByText(/4[45] min/)).toBeInTheDocument();
  });

  it('2+ horas → label hh + mm', () => {
    renderCard(makeOffer({ expires_at: new Date(Date.now() + 125 * 60_000).toISOString() }));
    expect(screen.getByText(/2 h/)).toBeInTheDocument();
  });
});

describe('OfferCard — accept flow', () => {
  it('happy: click Aceptar invoca POST y queda en pending visible', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      offer: { id: 'o1', status: 'aceptada' },
      assignment: { id: 'a1' },
      superseded_offer_ids: [],
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Aceptar oferta/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/offers/o1/accept', {}));
  });

  it('error ApiError offer_expired → mensaje traducido visible', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(409, 'offer_expired', null));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Aceptar oferta/ }));
    expect(await screen.findByText(/expiró/i)).toBeInTheDocument();
  });

  it('error 5xx → mensaje genérico de servidor', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(500, 'internal', null));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Aceptar oferta/ }));
    expect(await screen.findByText(/Error del servidor/)).toBeInTheDocument();
  });

  it('error no-ApiError → mensaje "Error inesperado"', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('boom'));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Aceptar oferta/ }));
    expect(await screen.findByText(/Error inesperado/)).toBeInTheDocument();
  });
});

describe('OfferCard — reject flow', () => {
  it('click Rechazar abre form, click Volver lo cierra', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }));
    expect(screen.getByLabelText(/Razón del rechazo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Volver/ }));
    expect(screen.queryByLabelText(/Razón del rechazo/)).not.toBeInTheDocument();
  });

  it('submit sin reason → POST con body vacío', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({ offer: { id: 'o1' } });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/offers/o1/reject', {}));
  });

  it('submit con reason → POST incluye reason trimmed', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({ offer: { id: 'o1' } });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }));
    fireEvent.change(screen.getByLabelText(/Razón del rechazo/), {
      target: { value: '  fuera de zona  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar rechazo/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/offers/o1/reject', { reason: 'fuera de zona' }),
    );
  });

  it('error en reject → muestra error y form sigue abierto', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(403, 'offer_forbidden', null));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar rechazo/ }));
    expect(await screen.findByText(/No tienes permiso/)).toBeInTheDocument();
  });
});

describe('OfferCard — eco preview', () => {
  it('default oculto, click "Ver impacto ambiental" lo abre y fetcha', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request_id: 'tr1',
      suggested_vehicle_id: null,
      distance_km: 130,
      duration_s: 5400,
      fuel_liters_estimated: 28,
      emisiones_kgco2e_wtw: 75,
      emisiones_kgco2e_ttw: 60,
      emisiones_kgco2e_wtt: 15,
      intensidad_gco2e_por_tonkm: 50,
      precision_method: 'modelado',
      data_source: 'routes_api',
      glec_version: 'GLEC v3.0',
      generated_at: '2026-05-10T00:00:00Z',
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Ver impacto ambiental/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/offers/o1/eco-preview'));
    expect(await screen.findByText(/130 km/)).toBeInTheDocument();
    expect(screen.getByText(/75\.0 kg CO₂e/)).toBeInTheDocument();
    expect(screen.getByText(/Google Routes API/)).toBeInTheDocument();
  });

  it('eco preview loading → spinner', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => undefined));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Ver impacto ambiental/ }));
    expect(await screen.findByText(/Calculando impacto ambiental/)).toBeInTheDocument();
  });

  it('eco preview error → fallback message', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, 'unauthorized', null));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Ver impacto ambiental/ }));
    expect(await screen.findByText(/No pudimos calcular el impacto/)).toBeInTheDocument();
  });

  it('data_source=tabla_chile → label correspondiente', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request_id: 'tr1',
      suggested_vehicle_id: null,
      distance_km: 100,
      duration_s: null,
      fuel_liters_estimated: null,
      emisiones_kgco2e_wtw: 50,
      emisiones_kgco2e_ttw: 40,
      emisiones_kgco2e_wtt: 10,
      intensidad_gco2e_por_tonkm: 25,
      precision_method: 'por_defecto',
      data_source: 'tabla_chile',
      glec_version: 'GLEC v3.0',
      generated_at: '2026-05-10T00:00:00Z',
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Ver impacto ambiental/ }));
    expect(await screen.findByText(/Estimación por región/)).toBeInTheDocument();
  });
});

describe('OfferCard — translate ApiError code branches', () => {
  const cases = [
    ['offer_not_found', /Esta oferta ya no existe/],
    ['offer_forbidden', /No tienes permiso/],
    ['offer_not_pending', /ya fue respondida/],
    ['trip_already_assigned', /Otro carrier aceptó primero/],
    ['no_active_empresa', /no tiene empresa activa/],
    ['not_a_carrier', /no opera como carrier/],
  ] as const;

  for (const [code, regex] of cases) {
    it(`code ${code} → ${regex}`, async () => {
      vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(403, code, null));
      renderCard();
      fireEvent.click(screen.getByRole('button', { name: /Aceptar oferta/ }));
      expect(await screen.findByText(regex)).toBeInTheDocument();
    });
  }

  it('ApiError unknown code 4xx → message del error', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(400, 'unknown_x', null, 'msg-from-err'),
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Aceptar oferta/ }));
    expect(await screen.findByText(/msg-from-err/)).toBeInTheDocument();
  });
});
