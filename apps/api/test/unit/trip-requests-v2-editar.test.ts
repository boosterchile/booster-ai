import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const editarMock = vi.fn();
const matchingMock = vi.fn();
const geocodeMock = vi.fn(async () => null);
vi.mock('../../src/services/editar-carga.js', () => ({
  editarCargaPreMatch: (...a: unknown[]) => editarMock(...a),
}));
vi.mock('../../src/services/matching.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/matching.js')>();
  return { ...actual, runMatching: (...a: unknown[]) => matchingMock(...a) };
});
vi.mock('../../src/services/geocodificar-origen.js', () => ({
  geocodificarOrigen: (...a: unknown[]) => geocodeMock(...(a as [])),
}));

const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const TRIP_ROW = {
  id: 'trip-1',
  trackingCode: 'BOO-1',
  status: 'esperando_match',
  originAddressRaw: 'A origen 123',
  destinationAddressRaw: 'B destino 456',
  cargoType: 'carga_seca',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};

function db() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => [TRIP_ROW]);
  return { select: vi.fn(() => chain) } as never;
}

function app(role = 'dueno') {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('userContext', {
      user: { id: 'user-1' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm1', role, status: 'activa' },
        empresa: {
          id: 'emp-1',
          isGeneradorCarga: true,
          isTransportista: false,
          status: 'activa',
          contratoProgramadoActivadoEn: null,
        },
      },
    } as never);
    await next();
  });
  a.route(
    '/trip-requests-v2',
    createTripRequestsV2Routes({ db: db(), logger, routesProjectId: 'proj' }),
  );
  return a;
}

const futuro = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const FORM = {
  origin: { address_raw: 'A origen 123', region_code: 'XIII' },
  destination: { address_raw: 'B destino 456', region_code: 'V' },
  cargo: { cargo_type: 'carga_seca', weight_kg: 2500 },
  pickup_window: { start_at: futuro(24), end_at: futuro(27) },
  proposed_price_clp: null,
  modalidad_carga: 'spot',
};
const put = (a: Hono, body: unknown) =>
  a.request('/trip-requests-v2/trip-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Los mockResolvedValueOnce no consumidos no deben filtrarse al test siguiente.
  matchingMock.mockReset();
});

describe('PUT /trip-requests-v2/:id (editar-anular-cargas §6.1)', () => {
  it('editada en esperando_match: corre el matching y devuelve el detalle', async () => {
    editarMock.mockResolvedValue({
      ok: true,
      cambio: true,
      estado: 'esperando_match',
      ofertasInvalidadas: 2,
      geocodificarOrigen: null,
    });
    matchingMock.mockResolvedValue({
      candidatesEvaluated: 3,
      offersCreated: 1,
      offers: [{ id: 'o9' }],
    });
    const res = await put(app(), FORM);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      trip_request: { id: 'trip-1', tracking_code: 'BOO-1' },
      matching: { candidates_evaluated: 3, offers_created: 1, offer_ids: ['o9'] },
      invalidated_offers: 2,
    });
    expect(editarMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tripId: 'trip-1',
        empresaId: 'emp-1',
        contratoProgramadoActivadoEn: null,
      }),
    );
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it('sin cambios en esperando_match igual corre el matching: destraba una carga cuyo matching falló al crearse (§7)', async () => {
    editarMock.mockResolvedValueOnce({
      ok: true,
      cambio: false,
      estado: 'esperando_match',
      ofertasInvalidadas: 0,
      geocodificarOrigen: null,
    });
    matchingMock.mockResolvedValueOnce({
      candidatesEvaluated: 2,
      offersCreated: 2,
      offers: [{ id: 'o1' }, { id: 'o2' }],
    });
    const res = await put(app(), FORM);
    expect(res.status).toBe(200);
    expect(matchingMock).toHaveBeenCalledWith(expect.objectContaining({ tripId: 'trip-1' }));
    expect(await res.json()).toMatchObject({
      matching: { candidates_evaluated: 2, offers_created: 2, offer_ids: ['o1', 'o2'] },
    });
  });

  it.each([
    ['sin cambios', false, 'ofertas_enviadas'],
    ['con cambios', true, 'borrador'],
  ])('%s en %s no corre el matching', async (_n, cambio, estado) => {
    editarMock.mockResolvedValueOnce({
      ok: true,
      cambio,
      estado,
      ofertasInvalidadas: 0,
      geocodificarOrigen: null,
    });
    const res = await put(app(), FORM);
    expect(res.status).toBe(200);
    expect(matchingMock).not.toHaveBeenCalled();
    expect(((await res.json()) as { matching: unknown }).matching).toBeNull();
  });

  it('origen nuevo sin coordenadas se geocodifica, condicionado a que el origen siga vigente', async () => {
    editarMock.mockResolvedValueOnce({
      ok: true,
      cambio: true,
      estado: 'borrador',
      ofertasInvalidadas: 0,
      geocodificarOrigen: { originAddress: 'Otro 9', destinationAddress: 'B destino 456' },
    });
    await put(app(), FORM);
    expect(geocodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'trip-1',
        originAddress: 'Otro 9',
        routesProjectId: 'proj',
        // Una respuesta atrasada de Routes no pisa un origen editado después.
        soloSiOrigenVigente: true,
      }),
    );
    expect(matchingMock).not.toHaveBeenCalled();
  });

  it('si el matching falla, la edición responde 200 con matching null', async () => {
    editarMock.mockResolvedValue({
      ok: true,
      cambio: true,
      estado: 'esperando_match',
      ofertasInvalidadas: 0,
      geocodificarOrigen: null,
    });
    matchingMock.mockRejectedValueOnce(new Error('caído'));
    const res = await put(app(), FORM);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { matching: unknown }).matching).toBeNull();
  });

  it.each([
    [{ ok: false, code: 'trip_not_found' }, 404, { code: 'trip_not_found' }],
    [{ ok: false, code: 'trip_busy' }, 409, { code: 'trip_busy' }],
    [
      { ok: false, code: 'trip_not_editable', currentStatus: 'asignado' },
      409,
      { code: 'trip_not_editable', current_status: 'asignado' },
    ],
    [
      { ok: false, code: 'contrato_programado_no_habilitado' },
      422,
      { code: 'contrato_programado_no_habilitado' },
    ],
  ])('resultado %j → %i', async (resultado, status, body) => {
    editarMock.mockResolvedValue(resultado);
    const res = await put(app(), FORM);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject(body);
  });

  it('visualizador → 403 read_only; formulario inválido → 400', async () => {
    expect((await put(app('visualizador'), FORM)).status).toBe(403);
    expect(
      (await put(app(), { ...FORM, cargo: { cargo_type: 'carga_seca', weight_kg: 0 } })).status,
    ).toBe(400);
    expect(editarMock).not.toHaveBeenCalled();
  });
});
