import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DatosLibresViaje } from './DatosLibresViaje.js';

describe('DatosLibresViaje', () => {
  it('muestra quién recibe, el botón para llamar, las notas y la referencia', () => {
    render(
      <DatosLibresViaje
        consignee={{ name: 'Bodega La Serena', phone_e164: '+56911111111' }}
        notes="Andén 4"
        reference="PO-1"
      />,
    );
    expect(screen.getByText('Recibe: Bodega La Serena')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Llamar \+56911111111/ })).toHaveAttribute(
      'href',
      'tel:+56911111111',
    );
    expect(screen.getByText('Andén 4')).toBeInTheDocument();
    expect(screen.getByText('Referencia: PO-1')).toBeInTheDocument();
  });

  it('solo notas: sin línea de destinatario', () => {
    render(<DatosLibresViaje consignee={{ name: null, phone_e164: null }} notes="Andén 4" />);
    expect(screen.queryByText(/Recibe:/)).not.toBeInTheDocument();
    expect(screen.getByText('Andén 4')).toBeInTheDocument();
  });

  it('teléfono sin nombre', () => {
    render(<DatosLibresViaje consignee={{ name: null, phone_e164: '+56911111111' }} />);
    expect(screen.getByText('Recibe: Sin nombre')).toBeInTheDocument();
  });

  it('sin ningún dato no muestra nada', () => {
    const { container } = render(<DatosLibresViaje consignee={null} notes={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
