import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CifraHuella, TotalHuella } from './CifraHuella.js';

/** `.specs/sello-huella-toda-la-web`, criterio 3. */
describe('CifraHuella', () => {
  it('primario: la cifra con «Medido»', () => {
    render(<CifraHuella valor={375.2} presentacion="primario" data-testid="c" />);
    const cifra = screen.getByTestId('c');
    expect(cifra).toHaveTextContent('375,2 kg CO₂e');
    expect(cifra).toHaveTextContent('Medido');
    expect(cifra).toHaveAttribute('data-presentacion', 'primario');
  });

  it('medido_teltonika: conserva su texto y no dice «Medido»', () => {
    render(<CifraHuella valor="820.5" presentacion="medido_teltonika" data-testid="c" />);
    const cifra = screen.getByTestId('c');
    expect(cifra).toHaveTextContent('820,5 kg CO₂e');
    expect(cifra).toHaveTextContent('Distancia medida con Teltonika · consumo modelado');
    expect(cifra).not.toHaveTextContent(/\bMedido\b/);
  });

  it('estimado: la cifra con «Estimado»', () => {
    render(<CifraHuella valor={1250} presentacion="estimado" data-testid="c" />);
    const cifra = screen.getByTestId('c');
    expect(cifra).toHaveTextContent('1,25 t CO₂e');
    expect(cifra).toHaveTextContent('Estimado');
  });

  it('intensidad: g CO₂e/t·km con su sello', () => {
    render(<CifraHuella valor={62.4} tipo="intensidad" presentacion="estimado" data-testid="c" />);
    const cifra = screen.getByTestId('c');
    expect(cifra).toHaveTextContent('62 g CO₂e/t·km');
    expect(cifra).toHaveTextContent('Estimado');
  });

  it('una presentación fuera del contrato se muestra «Estimado»', () => {
    render(<CifraHuella valor={10} presentacion={'otra' as 'estimado'} data-testid="c" />);
    expect(screen.getByTestId('c')).toHaveAttribute('data-presentacion', 'estimado');
    expect(screen.getByTestId('c')).toHaveTextContent('Estimado');
  });

  it('sin dato: no hay cifra, así que no lleva sello', () => {
    render(<CifraHuella valor={null} presentacion="primario" data-testid="c" />);
    const cifra = screen.getByTestId('c');
    expect(cifra).toHaveTextContent(/^Sin dato$/);
    expect(cifra.querySelector('[data-presentacion]')).toBeNull();
  });
});

describe('TotalHuella', () => {
  it('una línea por presentación con valor, en orden, y ninguna mezcla', () => {
    render(
      <TotalHuella
        porPresentacion={{ primario: 100, medido_teltonika: 0, estimado: 350 }}
        data-testid="t"
      />,
    );
    const lineas = screen.getByTestId('t').querySelectorAll('[data-cifra-huella]');
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toHaveAttribute('data-presentacion', 'primario');
    expect(lineas[0]).toHaveTextContent('100,0 kg CO₂e');
    expect(lineas[1]).toHaveAttribute('data-presentacion', 'estimado');
    expect(lineas[1]).toHaveTextContent('350,0 kg CO₂e');
  });

  it('sin valores: dice que no hay, sin cifra', () => {
    render(
      <TotalHuella
        porPresentacion={{ primario: 0, medido_teltonika: 0, estimado: 0 }}
        vacio="Sin certificados este mes"
        data-testid="t"
      />,
    );
    const total = screen.getByTestId('t');
    expect(total).toHaveTextContent('Sin certificados este mes');
    expect(total.querySelector('[data-cifra-huella]')).toBeNull();
  });
});
