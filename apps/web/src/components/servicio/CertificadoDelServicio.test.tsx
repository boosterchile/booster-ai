import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultadoAsignacion } from '../../services/assignment-resultado.js';

const getResultado = vi.fn();
const enviar = vi.fn();
vi.mock('../../services/assignment-resultado.js', () => ({
  getResultadoAsignacion: (...a: unknown[]) => getResultado(...a),
  enviarCertificadoAlCliente: (...a: unknown[]) => enviar(...a),
  descargarCertificadoDeAsignacion: vi.fn(),
}));

const { CertificadoDelServicio } = await import('./CertificadoDelServicio.js');

const CERO = { certificados: 0, kgco2e: 0, ahorro_kgco2e: 0 };

function resultado(extra: Partial<ResultadoAsignacion> = {}): ResultadoAsignacion {
  return {
    assignment: { id: 'a1', status: 'entregado', picked_up_at: null, delivered_at: null },
    trip: { id: 't1', tracking_code: 'BOO-PROPIO' },
    metrics: {
      distance_km_estimated: '110.00',
      distance_km_actual: null,
      carbon_emissions_kgco2e_estimated: '95.000',
      carbon_emissions_kgco2e_actual: null,
      precision_method: 'por_defecto',
      glec_version: 'v3.0',
      route_data_source: 'maps_directions',
      coverage_pct: '0',
      certification_level: 'secundario_default',
      linea_metodo: null,
      presentacion: 'estimado',
      certificate_pdf_url: null,
      certificate_sha256: null,
      certificate_kms_key_version: null,
      certificate_issued_at: null,
    },
    certificate: { issued_at: '2026-11-21T12:00:00Z', sha256: 'a', verify_url: 'https://x/verify' },
    viaje_propio: {
      cliente_nombre: 'Viña Santa Clara SpA',
      cliente_correo: 'compras@vina.cl',
      total_mes_cliente: {
        certificados: 2,
        por_presentacion: {
          primario: CERO,
          medido_teltonika: CERO,
          estimado: { certificados: 2, kgco2e: 190, ahorro_kgco2e: 0 },
        },
      },
    },
    ...extra,
  };
}

function renderizar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CertificadoDelServicio assignmentId="a1" />
    </QueryClientProvider>,
  );
}

describe('CertificadoDelServicio (.specs/frente2-cierre §3.3)', () => {
  beforeEach(() => {
    getResultado.mockReset();
    enviar.mockReset();
  });

  it('viaje propio: huella con sello, cliente, total del mes y «Enviar al cliente»', async () => {
    getResultado.mockResolvedValue(resultado());
    enviar.mockResolvedValue({ enviado: true, correo: 'compras@vina.cl' });
    renderizar();
    expect(
      await screen.findByRole('heading', { name: 'Viaje propio entregado y certificado' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cliente: Viña Santa Clara SpA')).toBeInTheDocument();
    expect(screen.getByTestId('certificado-servicio-huella')).toHaveTextContent(
      '95,0 kg CO₂eEstimado',
    );
    expect(screen.getByTestId('huella-mes-cliente')).toHaveTextContent('190,0 kg CO₂eEstimado');
    fireEvent.click(screen.getByTestId('enviar-al-cliente'));
    expect(await screen.findByTestId('enviado-al-cliente')).toHaveTextContent(
      'Enviado a compras@vina.cl.',
    );
    expect(enviar).toHaveBeenCalledWith('a1');
  });

  it('sin correo del cliente no ofrece enviar', async () => {
    const r = resultado();
    getResultado.mockResolvedValue({
      ...r,
      viaje_propio: r.viaje_propio ? { ...r.viaje_propio, cliente_correo: null } : null,
    });
    renderizar();
    await screen.findByRole('heading', { name: 'Viaje propio entregado y certificado' });
    expect(screen.queryByTestId('enviar-al-cliente')).not.toBeInTheDocument();
  });

  it('servicio del marketplace: sin cliente ni total por cliente', async () => {
    getResultado.mockResolvedValue(resultado({ viaje_propio: null }));
    renderizar();
    expect(
      await screen.findByRole('heading', { name: 'Viaje entregado y certificado' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('huella-mes-cliente')).not.toBeInTheDocument();
  });
});
