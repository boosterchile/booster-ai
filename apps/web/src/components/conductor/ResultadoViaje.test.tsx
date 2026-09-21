import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultadoAsignacion } from '../../services/assignment-resultado.js';

const getResultado = vi.fn();
vi.mock('../../services/assignment-resultado.js', () => ({
  getResultadoAsignacion: (...args: unknown[]) => getResultado(...args),
  descargarCertificadoDeAsignacion: vi.fn(),
}));

const { ResultadoViaje } = await import('./ResultadoViaje.js');

function resultado(
  cobertura: NonNullable<ResultadoAsignacion['cobertura']> | null,
  coveragePct = '0.00',
): ResultadoAsignacion {
  return {
    assignment: {
      id: 'asg-1',
      status: 'entregado',
      picked_up_at: '2026-09-21T18:00:00Z',
      delivered_at: '2026-09-21T19:30:00Z',
    },
    trip: { id: 'trip-1', tracking_code: 'BOO-83ND2C' },
    metrics: {
      distance_km_estimated: '80.00',
      distance_km_actual: null,
      carbon_emissions_kgco2e_estimated: '20.000',
      carbon_emissions_kgco2e_actual: null,
      precision_method: 'modelado',
      glec_version: '3.0',
      route_data_source: 'maps_directions',
      coverage_pct: coveragePct,
      certification_level: 'secundario_modeled',
      linea_metodo:
        'Distancia estimada por ruta (Google Routes) · Consumo modelado según GLEC v3.0',
      certificate_pdf_url: null,
      certificate_sha256: null,
      certificate_kms_key_version: null,
      certificate_issued_at: null,
    },
    cobertura,
    certificate: null,
  };
}

describe('ResultadoViaje — cobertura 0 con puntos del teléfono', () => {
  beforeEach(() => {
    getResultado.mockReset();
  });

  it('17 puntos ralos no se muestran como «0 %» ni como cobertura insuficiente', async () => {
    getResultado.mockResolvedValue(
      resultado({
        motivo: 'sin_tramo_continuo',
        fuente: 'movil_gps',
        puntos_telefono: 17,
        puntos_en_tramo: 17,
      }),
    );
    render(<ResultadoViaje assignmentId="asg-1" />);
    const cobertura = await screen.findByTestId('cobertura-posicion');
    expect(cobertura).toHaveTextContent(/17 puntos del teléfono/);
    expect(cobertura).toHaveTextContent(/más de un minuto/);
    expect(cobertura.textContent ?? '').not.toMatch(/0 %/);
    const panel = screen.getByTestId('resultado-viaje');
    expect(panel).toHaveTextContent(/Huella estimada/);
    expect(panel.textContent ?? '').not.toMatch(/cobertura insuficiente/);
    expect(panel.textContent ?? '').not.toMatch(/\btenés\b|\belegí\b|\bquerés\b/);
  });

  it('separa sin telemetría del dispositivo de los puntos del teléfono', async () => {
    getResultado.mockResolvedValue(
      resultado({
        motivo: 'sin_telemetria_dispositivo',
        fuente: 'teltonika_gps',
        puntos_telefono: 17,
        puntos_en_tramo: 0,
      }),
    );
    render(<ResultadoViaje assignmentId="asg-1" />);
    const cobertura = await screen.findByTestId('cobertura-posicion');
    expect(cobertura).toHaveTextContent(/Sin telemetría del dispositivo/);
    expect(cobertura).toHaveTextContent(/17 puntos del teléfono no entran/);
    expect(cobertura.textContent ?? '').not.toMatch(/0 %/);
  });

  it('un porcentaje entre 0 y 1 no se redondea a 0 %', async () => {
    getResultado.mockResolvedValue(resultado(null, '0.40'));
    render(<ResultadoViaje assignmentId="asg-1" />);
    const cobertura = await screen.findByTestId('cobertura-posicion');
    expect(cobertura.textContent ?? '').toMatch(/0[,.]4 %/);
    expect(cobertura.textContent ?? '').not.toMatch(/^0 %$/);
  });
});
