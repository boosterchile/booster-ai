import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TablaMedicion } from './TablaMedicion.js';

describe('TablaMedicion (.specs/frente2-cierre §3.1)', () => {
  it('una fila por dato con su fuente y su clase, y el nivel con lo que falta', () => {
    render(
      <TablaMedicion
        data-testid="m"
        medicion={{
          filas: [
            {
              magnitud: 'distancia',
              fuente: 'Teltonika del camión (cobertura 92 %)',
              clase: 'medido',
            },
            {
              magnitud: 'combustible',
              fuente: 'Modelo GLEC v3.0 con el perfil del vehículo',
              clase: 'modelado',
            },
            { magnitud: 'peso', fuente: 'Declarado en la carga (12.000 kg)', clase: 'declarado' },
          ],
          nivel: {
            nivel: 'secundario_modeled',
            nombre: 'Secundario modelado',
            falta: ['medir el consumo con el CAN del camión'],
            frase:
              'Para llegar a primario verificable falta medir el consumo con el CAN del camión.',
          },
        }}
      />,
    );
    const filas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(filas.map((f) => f.textContent)).toEqual([
      'DistanciaTeltonika del camión (cobertura 92 %)Medido',
      'CombustibleModelo GLEC v3.0 con el perfil del vehículoModelado',
      'PesoDeclarado en la carga (12.000 kg)Declarado',
    ]);
    expect(screen.getByTestId('m-nivel')).toHaveTextContent(
      'Nivel: Secundario modelado. Para llegar a primario verificable falta medir el consumo con el CAN del camión.',
    );
  });
});
