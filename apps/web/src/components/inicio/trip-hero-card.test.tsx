import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TripHeroCard } from './trip-hero-card.js';

describe('TripHeroCard', () => {
  it('muestra el tramo y la ventana de retiro, sin ETA ni puntaje', () => {
    render(
      <TripHeroCard
        cuando="Tu próximo viaje · Hoy 16:30"
        ruta="Quilicura → San Antonio"
        retiro={{ lugar: 'Av. Lo Echevers 550', detalle: 'Ventana 16:30–17:30 · Carga seca 12 t' }}
        entrega={{ lugar: 'Puerto San Antonio', detalle: null }}
      >
        <button type="button">Iniciar viaje</button>
      </TripHeroCard>,
    );
    expect(screen.getByText('Quilicura → San Antonio')).toBeInTheDocument();
    expect(screen.getByText(/Ventana 16:30–17:30/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar viaje' })).toBeInTheDocument();
    expect(screen.queryByText(/ETA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/puntaje/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/licencia/i)).not.toBeInTheDocument();
  });
});
