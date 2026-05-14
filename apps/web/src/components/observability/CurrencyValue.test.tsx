import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CurrencyValue } from './CurrencyValue.js';

describe('CurrencyValue', () => {
  it('formatea CLP con separadores es-CL', () => {
    render(<CurrencyValue amountClp={1234567} />);
    expect(screen.getByText(/1\.234\.567/)).toBeInTheDocument();
  });

  it('redondea decimales antes de formatear', () => {
    render(<CurrencyValue amountClp={1234.7} />);
    expect(screen.getByText(/\$1\.235 CLP/)).toBeInTheDocument();
  });

  it('muestra delta% en rojo cuando aumenta (gasto malo)', () => {
    render(<CurrencyValue amountClp={1000} deltaPercent={15.5} />);
    expect(screen.getByText(/15\.5%/)).toBeInTheDocument();
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('muestra delta% en verde cuando baja (gasto bueno)', () => {
    render(<CurrencyValue amountClp={1000} deltaPercent={-5.2} />);
    expect(screen.getByText(/5\.2%/)).toBeInTheDocument();
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('no renderiza delta cuando es null', () => {
    render(<CurrencyValue amountClp={1000} deltaPercent={null} />);
    expect(screen.queryByText('%')).not.toBeInTheDocument();
  });

  it('no renderiza delta cuando es undefined', () => {
    render(<CurrencyValue amountClp={1000} />);
    expect(screen.queryByText('%')).not.toBeInTheDocument();
  });

  it('acepta prefix y suffix custom', () => {
    render(<CurrencyValue amountClp={42} prefix="USD " suffix="" />);
    expect(screen.getByText(/USD 42/)).toBeInTheDocument();
  });
});
