import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreciosRoute } from './precios.js';

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PreciosRoute />
    </QueryClientProvider>,
  );
}

function responder(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const PUBLICADO = {
  version: 4,
  vigente_desde: '2026-10-08T12:00:00.000Z',
  servicios: CONFIGURACION_COMERCIAL_INICIAL.servicios,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/precios (T10-29, ADR-079 §4)', () => {
  it('muestra las suscripciones en UF de la versión publicada', async () => {
    const fetchSpy = responder(200, PUBLICADO);
    renderRoute();
    expect(await screen.findByText('Generadores de carga')).toBeInTheDocument();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/\/public\/precios$/);
    expect(screen.getByTestId('precio-generador')).toHaveTextContent('1 UF');
    expect(screen.getByTestId('precio-transportista')).toHaveTextContent('1 UF');
    expect(screen.getByTestId('precio-gestion-flota')).toHaveTextContent('1,5 UF');
    expect(screen.getByText('Tu primer camión no paga suscripción.')).toBeInTheDocument();
    expect(screen.getByText(/Huella de carbono/)).toBeInTheDocument();
    expect(screen.getByText(/Se cotiza por proyecto/)).toBeInTheDocument();
    expect(screen.getByText(/Versión 4 · vigente desde/)).toBeInTheDocument();
  });

  it('refleja un cambio publicado (otra versión, otros valores)', async () => {
    responder(200, {
      ...PUBLICADO,
      version: 5,
      servicios: {
        ...PUBLICADO.servicios,
        suscripcion_generador_uf_empresa_mes: 2.25,
        camiones_sin_cobro_por_transportista: 3,
        huella_carbono: { modalidad: 'por_proyecto', precio_referencia_uf: 12 },
      },
    });
    renderRoute();
    expect(await screen.findByTestId('precio-generador')).toHaveTextContent('2,25 UF');
    expect(screen.getByText('Tus primeros 3 camiones no pagan suscripción.')).toBeInTheDocument();
    expect(screen.getByText(/desde 12 UF/)).toBeInTheDocument();
  });

  it('sin camiones exentos no muestra el aviso', async () => {
    responder(200, {
      ...PUBLICADO,
      servicios: { ...PUBLICADO.servicios, camiones_sin_cobro_por_transportista: 0 },
    });
    renderRoute();
    await screen.findByText('Generadores de carga');
    expect(screen.queryByText(/no paga/)).not.toBeInTheDocument();
  });

  it('nunca muestra tasas de comisión', async () => {
    responder(200, PUBLICADO);
    const { container } = renderRoute();
    await screen.findByText('Generadores de carga');
    expect(container.textContent).not.toMatch(/%/);
    expect(screen.getByText(/La comisión por viaje se informa/)).toBeInTheDocument();
  });

  it('404 (modelo aún no vigente) → aviso de precios en actualización', async () => {
    responder(404, { error: 'precios_no_publicados' });
    renderRoute();
    expect(await screen.findByText(/Estamos actualizando nuestros precios/)).toBeInTheDocument();
  });

  it('respuesta fuera de contrato o error de red → mismo aviso', async () => {
    responder(200, { version: 'x' });
    const { unmount } = renderRoute();
    expect(await screen.findByText(/Estamos actualizando nuestros precios/)).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('red'));
    renderRoute();
    expect(await screen.findByText(/Estamos actualizando nuestros precios/)).toBeInTheDocument();
  });
});
