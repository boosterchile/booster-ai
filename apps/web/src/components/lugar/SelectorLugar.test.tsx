import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SelectorLugar } from './SelectorLugar.js';

function renderSelector(overrides?: Partial<ComponentProps<typeof SelectorLugar>>) {
  const props = {
    etiquetaDireccion: 'Dirección de recogida',
    placeholderDireccion: 'Av. Apoquindo 5550, Las Condes',
    direccion: '',
    region: '' as const,
    comunaCode: '',
    latitude: null,
    longitude: null,
    mapasDisponibles: false,
    onDireccion: vi.fn(),
    onRegion: vi.fn(),
    onComuna: vi.fn(),
    onCoordenadas: vi.fn(),
    onLugar: vi.fn(),
    resolverEnlace: vi.fn(async () => null),
    ...overrides,
  };
  render(<SelectorLugar {...props} />);
  return props;
}

describe('SelectorLugar', () => {
  it('sin mapas deja texto libre, región y comuna', () => {
    renderSelector();
    expect(screen.getByLabelText(/Dirección de recogida/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Región/)).toBeInTheDocument();
    expect(screen.getByLabelText('Comuna')).toBeDisabled();
    expect(screen.getByText(/El mapa no está disponible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /punto en el mapa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('al elegir la región muestra las comunas de esa región', async () => {
    const user = userEvent.setup();
    const props = renderSelector();
    await user.selectOptions(screen.getByLabelText(/Región/), 'XIII');
    expect(props.onRegion).toHaveBeenCalledWith('XIII');
  });

  it('la comuna de la región se puede cambiar', async () => {
    const user = userEvent.setup();
    const props = renderSelector({ region: 'XIII' });
    const comuna = screen.getByLabelText('Comuna');
    expect(comuna).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Las Condes' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Concepción' })).not.toBeInTheDocument();
    await user.selectOptions(comuna, '13114');
    expect(props.onComuna).toHaveBeenCalledWith('13114');
  });

  it('pegar coordenadas guarda el punto sin red', async () => {
    const user = userEvent.setup();
    const props = renderSelector();
    const campo = screen.getByLabelText(/Link de Google Maps/);
    await user.type(campo, '-33.45, -70.66');
    await user.tab();
    expect(props.onCoordenadas).toHaveBeenCalledWith(-33.45, -70.66);
    expect(props.onDireccion).toHaveBeenCalledWith('Punto en el mapa (-33.45000, -70.66000)');
    expect(props.resolverEnlace).not.toHaveBeenCalled();
  });

  it('un link corto se resuelve y deja el pin', async () => {
    const user = userEvent.setup();
    const props = renderSelector({
      resolverEnlace: vi.fn(async () => ({ latitude: -33.4391, longitude: -70.6488 })),
    });
    const campo = screen.getByLabelText(/Link de Google Maps/);
    await user.type(campo, 'https://maps.app.goo.gl/cFmSSGQDfS2tzWex7');
    await user.tab();
    expect(props.resolverEnlace).toHaveBeenCalledWith('https://maps.app.goo.gl/cFmSSGQDfS2tzWex7');
    expect(props.onCoordenadas).toHaveBeenCalledWith(-33.4391, -70.6488);
  });

  it('si el link no trae punto, lo dice y no borra el texto libre', async () => {
    const user = userEvent.setup();
    const props = renderSelector({ direccion: 'Compañía 4425' });
    const campo = screen.getByLabelText(/Link de Google Maps/);
    await user.type(campo, 'https://maps.app.goo.gl/sinPunto');
    await user.tab();
    expect(await screen.findByText(/No pudimos leer un punto/)).toBeInTheDocument();
    expect(props.onDireccion).not.toHaveBeenCalled();
  });

  it('escribir la dirección no la rechaza', () => {
    const props = renderSelector();
    fireEvent.change(screen.getByLabelText(/Dirección de recogida/), {
      target: { value: 'Compañía 4425' },
    });
    expect(props.onDireccion).toHaveBeenCalledWith('Compañía 4425');
  });
});
