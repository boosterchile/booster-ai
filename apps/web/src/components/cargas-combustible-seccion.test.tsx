import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

/**
 * Sección «Cargas de combustible» de la ficha del vehículo
 * (`.specs/registro-cargas-combustible`): registra, lista y anula.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('../lib/api-client.js', async (orig) => {
  const actual = await orig<typeof import('../lib/api-client.js')>();
  return {
    ...actual,
    api: {
      get: (p: string) => getMock(p),
      post: (p: string, b: unknown) => postMock(p, b),
      delete: (p: string) => deleteMock(p),
    },
  };
});

const { ApiError } = await import('../lib/api-client.js');
const { CargasCombustibleSeccion } = await import('./cargas-combustible-seccion.js');

const VEHICULO = 'v-1';
const BASE = `/vehiculos/${VEHICULO}/cargas-combustible`;
const CARGA = {
  id: 'c-1',
  vehiculo_id: VEHICULO,
  cargada_en: '2026-10-28T12:30:00.000Z',
  litros: 100,
  lugar: 'Copec Ruta 5',
  registrada_en: '2026-11-27T15:00:00.000Z',
  anulada_en: null,
};

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('CargasCombustibleSeccion', () => {
  it('lista las cargas registradas con fecha en hora de Santiago, litros y lugar', async () => {
    getMock.mockResolvedValue({ cargas: [CARGA] });
    wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    const lista = await screen.findByRole('list', { name: 'Cargas registradas' });
    expect(within(lista).getByText('100 L')).toBeInTheDocument();
    expect(within(lista).getByText('Copec Ruta 5')).toBeInTheDocument();
    expect(within(lista).getByText(/^28-10-2026, 9:30/)).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(BASE);
  });

  it('sin cargas lo dice', async () => {
    getMock.mockResolvedValue({ cargas: [] });
    wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    expect(await screen.findByText('Todavía no hay cargas registradas.')).toBeInTheDocument();
  });

  it('registra una carga con coma decimal y lugar, y vuelve a pedir la lista', async () => {
    getMock.mockResolvedValue({ cargas: [] });
    postMock.mockResolvedValue({ carga: CARGA });
    const user = userEvent.setup();
    wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    await screen.findByText('Todavía no hay cargas registradas.');
    const fecha = screen.getByLabelText(/Fecha y hora/);
    await user.clear(fecha);
    await user.type(fecha, '2026-10-28T09:30');
    await user.type(screen.getByLabelText(/^Litros/), '99,5');
    await user.type(screen.getByLabelText(/Lugar/), '  Copec Ruta 5 ');
    await user.click(screen.getByRole('button', { name: 'Registrar carga' }));
    expect(await screen.findByText('Carga registrada.')).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith(BASE, {
      cargada_en: new Date('2026-10-28T09:30').toISOString(),
      litros: 99.5,
      lugar: 'Copec Ruta 5',
    });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('litros fuera de rango no llaman al api', async () => {
    getMock.mockResolvedValue({ cargas: [] });
    const user = userEvent.setup();
    wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    await user.type(screen.getByLabelText(/^Litros/), '2500');
    await user.click(screen.getByRole('button', { name: 'Registrar carga' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Los litros van de 0,1 a 2.000.');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('una carga duplicada muestra que ya está registrada', async () => {
    getMock.mockResolvedValue({ cargas: [] });
    postMock.mockRejectedValue(new ApiError(409, 'carga_duplicada', null));
    const user = userEvent.setup();
    wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    await user.type(screen.getByLabelText(/^Litros/), '100');
    await user.click(screen.getByRole('button', { name: 'Registrar carga' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa carga ya está registrada.');
  });

  it('anula con confirmación y vuelve a pedir la lista', async () => {
    getMock.mockResolvedValueOnce({ cargas: [CARGA] }).mockResolvedValue({ cargas: [] });
    deleteMock.mockResolvedValue({ carga: { ...CARGA, anulada_en: '2026-11-27T16:00:00.000Z' } });
    const user = userEvent.setup();
    wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    await user.click(await screen.findByRole('button', { name: 'Anular' }));
    expect(screen.getByText('¿Anular esta carga?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sí, anular' }));
    expect(deleteMock).toHaveBeenCalledWith(`${BASE}/c-1`);
    expect(await screen.findByText('Todavía no hay cargas registradas.')).toBeInTheDocument();
  });

  it('cancelar la anulación no llama al api', async () => {
    getMock.mockResolvedValue({ cargas: [CARGA] });
    const user = userEvent.setup();
    wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    await user.click(await screen.findByRole('button', { name: 'Anular' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Anular' })).toBeInTheDocument();
  });

  it('sin violaciones de accesibilidad', async () => {
    getMock.mockResolvedValue({ cargas: [CARGA] });
    const { container } = wrap(<CargasCombustibleSeccion vehiculoId={VEHICULO} />);
    await screen.findByRole('list', { name: 'Cargas registradas' });
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
