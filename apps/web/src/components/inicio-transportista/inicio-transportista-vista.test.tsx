import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InicioTransportistaVista } from './inicio-transportista-vista.js';
import { type DatosInicio, buildInicioVista } from './modelo.js';
import { buildNegocioHoy } from './negocio.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children?: ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : undefined} {...props}>
      {children}
    </a>
  ),
}));

const AHORA = new Date('2026-10-19T15:00:00.000Z');

function base(sobre: Partial<DatosInicio> = {}): DatosInicio {
  return {
    ofertas: { estado: 'listo', valor: [] },
    servicios: { estado: 'listo', valor: [] },
    cumplimiento: { estado: 'listo', valor: { vencidos: 0, porVencer30d: 0, documentos: [] } },
    flota: { estado: 'listo', valor: [] },
    vehiculos: { estado: 'listo', valor: 1 },
    conductores: { estado: 'listo', valor: 1 },
    cobraHoy: 'disponible',
    ...sobre,
  };
}

function pintar(datos: DatosInicio) {
  const vista = buildInicioVista(datos, {
    nombreCompleto: 'Felipe Vicencio',
    legalName: 'Transportes Van Oosterwyk',
    esAdmin: true,
    ahora: AHORA,
  });
  render(
    <InicioTransportistaVista
      vista={vista}
      negocio={buildNegocioHoy(datos, AHORA)}
      onReintentar={() => undefined}
    />,
  );
}

describe('InicioTransportistaVista', () => {
  it('en cero muestra cada bloque y no deja una CTA verde', () => {
    pintar(base());
    expect(screen.getByRole('heading', { name: 'Tu negocio hoy' })).toBeInTheDocument();
    expect(screen.getByText('Sin ofertas nuevas')).toBeInTheDocument();
    expect(screen.getByText('Sin retiros próximos')).toBeInTheDocument();
    expect(screen.getAllByText('Flota al día').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Documentos al día').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ver ofertas')).not.toBeInTheDocument();
    expect(screen.queryByText('Asignar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inicio-plata')).not.toBeInTheDocument();
    expect(screen.getByTestId('inicio-accesos')).toHaveClass('md:hidden');
    expect(screen.getByTestId('inicio-mapa-flota')).toHaveClass('hidden', 'md:block');
    const linea = screen.getByText(/Transportes Van Oosterwyk/).closest('p');
    expect(linea?.textContent).toMatch(/octubre/);
    expect(linea?.textContent).toMatch(/· Transportista/);
  });

  it('en carga muestra el skeleton de cada bloque y no el vacío', () => {
    pintar(
      base({
        ofertas: { estado: 'cargando' },
        servicios: { estado: 'cargando' },
        cumplimiento: { estado: 'cargando' },
        flota: { estado: 'cargando' },
      }),
    );
    expect(screen.getByTestId('skeleton-ofertas')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-retiros')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-avisos')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-avisos-desktop')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-mapa')).toBeInTheDocument();
    expect(screen.queryByText('Sin ofertas nuevas')).not.toBeInTheDocument();
    expect(screen.queryByText('Sin avisos para mostrar.')).not.toBeInTheDocument();
  });

  it('un bloque en error deja el reintento y no esconde los demás', () => {
    pintar(
      base({
        ofertas: { estado: 'error' },
        servicios: { estado: 'listo', valor: [] },
        flota: { estado: 'error' },
      }),
    );
    expect(screen.getByText('No cargó Ofertas')).toBeInTheDocument();
    expect(screen.getByTestId('reintentar-ofertas')).toBeInTheDocument();
    expect(screen.getByText('Sin retiros próximos')).toBeInTheDocument();
    expect(screen.getByText('No cargó Flota')).toBeInTheDocument();
    expect(screen.getAllByText('Documentos al día').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('inicio-mapa-flota')).not.toBeInTheDocument();
    expect(screen.getByTestId('inicio-avisos')).toBeInTheDocument();
  });

  it('muestra 3 retiros en la lista móvil, 5 en la tabla y un solo Asignar por layout', () => {
    const servicios = Array.from({ length: 6 }, (_, indice) => ({
      id: `a-${indice}`,
      status: 'asignado',
      sinConductor: indice === 1,
      pickupInicio: new Date(AHORA.getTime() + (indice + 1) * 60 * 60_000).toISOString(),
      direccionOrigen: `Bodega, Comuna${indice}`,
      direccionDestino: 'Puerto, Destino',
      patente: 'KXJR42',
      conductor: indice === 1 ? null : 'Juan Pérez',
    }));
    pintar(base({ servicios: { estado: 'listo', valor: servicios } }));
    expect(screen.getAllByTestId(/^retiro-movil-/)).toHaveLength(3);
    expect(screen.getAllByTestId(/^retiro-desktop-/)).toHaveLength(5);
    expect(screen.getAllByText('Asignar')).toHaveLength(2);
    expect(screen.getAllByText('Sin conductor').length).toBeGreaterThan(0);
  });
});
