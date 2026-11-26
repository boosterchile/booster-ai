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
      presentacion: 'estimado',
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
    expect(screen.getByTestId('resultado-huella')).toHaveTextContent('20,0 kg CO₂eEstimado');
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

describe('ResultadoViaje — sello de la huella (ADR-091)', () => {
  beforeEach(() => {
    getResultado.mockReset();
  });

  it('distancia medida con Teltonika: la cifra lleva su texto y no dice «Medido» ni «Huella medida»', async () => {
    const r = resultado(null, '92.00');
    if (!r.metrics) {
      throw new Error('fixture sin métricas');
    }
    r.metrics = {
      ...r.metrics,
      carbon_emissions_kgco2e_actual: '18.500',
      route_data_source: 'teltonika_gps',
      presentacion: 'medido_teltonika',
    };
    getResultado.mockResolvedValue(r);
    render(<ResultadoViaje assignmentId="asg-1" />);
    const huella = await screen.findByTestId('resultado-huella');
    expect(huella).toHaveTextContent('18,5 kg CO₂e');
    expect(huella).toHaveTextContent('Distancia medida con Teltonika · consumo modelado');
    expect(screen.getByTestId('resultado-viaje').textContent ?? '').not.toMatch(
      /Huella medida|\bMedido\b/,
    );
  });

  it('primario: «Medido»; respuesta vieja sin presentación: «Estimado»', async () => {
    const r = resultado(null, '98.00');
    if (!r.metrics) {
      throw new Error('fixture sin métricas');
    }
    r.metrics = { ...r.metrics, presentacion: 'primario' };
    getResultado.mockResolvedValue(r);
    const { unmount } = render(<ResultadoViaje assignmentId="asg-1" />);
    expect(await screen.findByTestId('resultado-huella')).toHaveTextContent('Medido');
    unmount();
    const { presentacion: _sin, ...vieja } = r.metrics;
    getResultado.mockResolvedValue({ ...r, metrics: vieja });
    render(<ResultadoViaje assignmentId="asg-1" />);
    expect(await screen.findByTestId('resultado-huella')).toHaveTextContent('Estimado');
  });
});

describe('ResultadoViaje — qué se midió (.specs/frente2-cierre §3.1)', () => {
  beforeEach(() => {
    getResultado.mockReset();
  });

  it('con medicion del API muestra la tabla y el nivel con lo que falta', async () => {
    const r = resultado(null, '0.00');
    if (!r.metrics) {
      throw new Error('fixture sin métricas');
    }
    r.metrics = {
      ...r.metrics,
      medicion: {
        filas: [
          { magnitud: 'distancia', fuente: 'Ruta calculada con Google Routes', clase: 'estimado' },
          {
            magnitud: 'combustible',
            fuente: 'Modelo GLEC v3.0 con el perfil del vehículo',
            clase: 'modelado',
          },
          { magnitud: 'peso', fuente: 'Sin peso declarado', clase: 'sin_dato' },
        ],
        nivel: {
          nivel: 'secundario_modeled',
          nombre: 'Secundario modelado',
          falta: [
            'medir la distancia con un Teltonika instalado en el camión',
            'medir el consumo con el CAN del camión',
          ],
          frase:
            'Para llegar a primario verificable falta medir la distancia con un Teltonika instalado en el camión y medir el consumo con el CAN del camión.',
        },
      },
    };
    getResultado.mockResolvedValue(r);
    render(<ResultadoViaje assignmentId="asg-1" />);
    const tabla = await screen.findByTestId('resultado-medicion');
    expect(tabla).toHaveTextContent('DistanciaRuta calculada con Google RoutesEstimado');
    expect(screen.getByTestId('resultado-medicion-nivel')).toHaveTextContent(
      'Nivel: Secundario modelado.',
    );
  });
});
