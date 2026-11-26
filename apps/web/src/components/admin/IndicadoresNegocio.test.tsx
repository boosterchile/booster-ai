import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../lib/api-client.js', () => ({ api: { get: (ruta: string) => get(ruta) } }));

const { IndicadoresNegocio } = await import('./IndicadoresNegocio.js');

const EMPRESA = '22222222-2222-4222-8222-222222222222';

function respuesta(empresaId: string | null, extra: Record<string, unknown> = {}) {
  return {
    empresa_id: empresaId,
    empresas: [{ id: EMPRESA, nombre: 'Transportes Uno SpA' }],
    indicadores: {
      empresas_activas: empresaId ? null : 4,
      cargas: 12,
      camiones: 5,
      camiones_con_huella_medida: 1,
      certificados: {
        certificados: 3,
        medidos: 1,
        estimados: 2,
        kgco2e: 1254.5,
        ahorro_kgco2e: 0,
        por_presentacion: {
          primario: { certificados: 1, kgco2e: 375.2, ahorro_kgco2e: 0 },
          medido_teltonika: { certificados: 1, kgco2e: 820.5, ahorro_kgco2e: 0 },
          estimado: { certificados: 1, kgco2e: 58.8, ahorro_kgco2e: 0 },
        },
      },
      documentos_pendientes: 6,
      ...extra,
    },
  };
}

describe('IndicadoresNegocio', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('muestra los indicadores de la plataforma con las emisiones separadas por sello', async () => {
    get.mockResolvedValue(respuesta(null));
    render(<IndicadoresNegocio />);
    expect(await screen.findByTestId('indicador-documentos-pendientes')).toHaveTextContent('6');
    expect(get).toHaveBeenCalledWith('/admin/plataforma/indicadores');
    expect(screen.getByTestId('indicador-empresas-activas')).toHaveTextContent('4');
    expect(screen.getByTestId('indicador-camiones')).toHaveTextContent('5');
    expect(screen.getByTestId('indicador-camiones-nota')).toHaveTextContent('1 con huella medida');
    expect(screen.getByTestId('indicador-certificados-nota')).toHaveTextContent(
      '1 medidos · 1 con distancia medida con Teltonika · 1 estimados',
    );
    const lineas = screen
      .getByTestId('indicador-emisiones')
      .querySelectorAll('[data-cifra-huella]');
    expect([...lineas].map((l) => l.getAttribute('data-presentacion'))).toEqual([
      'primario',
      'medido_teltonika',
      'estimado',
    ]);
    expect(lineas[0]).toHaveTextContent('375,2 kg CO₂eMedido');
    expect(lineas[1]).toHaveTextContent('820,5 kg CO₂eDistancia medida con Teltonika');
    expect(lineas[2]).toHaveTextContent('58,8 kg CO₂eEstimado');
  });

  it('al elegir una empresa pide sus indicadores y deja de contar empresas', async () => {
    get.mockImplementation(async (ruta: string) =>
      ruta.includes('empresa_id') ? respuesta(EMPRESA, { cargas: 2 }) : respuesta(null),
    );
    render(<IndicadoresNegocio />);
    await screen.findByTestId('indicadores-de-plataforma');
    fireEvent.change(screen.getByTestId('indicadores-empresa'), { target: { value: EMPRESA } });
    await screen.findByTestId(`indicadores-de-${EMPRESA}`);
    expect(get).toHaveBeenLastCalledWith(`/admin/plataforma/indicadores?empresa_id=${EMPRESA}`);
    expect(screen.getByTestId('indicador-cargas')).toHaveTextContent('2');
    expect(screen.queryByTestId('indicador-empresas-activas')).not.toBeInTheDocument();
  });

  it('una respuesta inválida o un error se dicen', async () => {
    get.mockResolvedValueOnce({ otra: 'cosa' });
    const { unmount } = render(<IndicadoresNegocio />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no es válida');
    unmount();
    get.mockRejectedValueOnce(new Error('sin conexión'));
    render(<IndicadoresNegocio />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('sin conexión'));
  });
});
